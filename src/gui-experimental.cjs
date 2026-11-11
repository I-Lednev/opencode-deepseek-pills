"use strict"

const { ComposerPill, Command, Ipc, Plugin, Style } = require("@opencode/plugin/gui")
const { createSignal } = require("solid-js")
const { Schema } = require("effect")

// Фиксированный курс пересчёта USD -> CNY.
// Измените это значение, если нужен другой курс.
const CNY_PER_USD = 6.6854

// Версия плагина и адрес манифеста обновлений на GitHub Pages.
const PLUGIN_VERSION = "1.2.0"
const UPDATE_MANIFEST_URL = "https://i-lednev.github.io/opencode-deepseek-pills/version.json"
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000

// Немного растягиваем пилюли: если строка не помещается в окно, они переносятся
// на вторую строку вместо обрезки текста. Отступы чуть меньше, чтобы влезало больше.
const PILL_STYLE = `
div[data-component="session-plugin-pills"] {
  flex-wrap: wrap;
  justify-content: inherit;
  gap: 6px;
  max-width: 100%;
}
button[data-slot="session-plugin-pill"] {
  flex-shrink: 0;
  max-width: min(340px, 100%);
  padding-inline: 8px;
}
button[data-slot="session-plugin-pill"] > span {
  max-width: 320px;
}
`

function openPlati(ctx) {
  const url = PLATI_PRODUCT_URL

  try {
    if (ctx?.system && typeof ctx.system.openExternal === "function") {
      const result = ctx.system.openExternal(url)
      if (result && typeof result.catch === "function") {
        result.catch(() => openPlatiFallback(url))
      }
      return
    }
  } catch {}

  openPlatiFallback(url)
}

function openPlatiFallback(url) {
  try {
    window.open(url, "_blank", "noopener,noreferrer")
  } catch (error) {
    console.error("deepseek-balance: failed to open plati", error)
  }
}

function openExternalUrl(ctx, url) {
  if (!url) return

  try {
    if (ctx?.system && typeof ctx.system.openExternal === "function") {
      const result = ctx.system.openExternal(url)
      if (result && typeof result.catch === "function") {
        result.catch(() => openPlatiFallback(url))
      }
      return
    }
  } catch {}

  openPlatiFallback(url)
}

// Курс пополнения DeepSeek через plati.market (The Cheap One).
const PLATI_PRODUCT_ID = "5874678"
const PLATI_PRODUCT_URL =
  "https://plati.market/itm/24-7-no-login-deepseek-api-deepseek-api-balance-replenishment/5874678"
const PLATI_PRICE_URL = `https://plati.market/asp/price_options.asp?p=${PLATI_PRODUCT_ID}&n=1&c=RUR&x=&rnd=`
const RATE_SEED_RATE = 96
const RATE_SEED_DAYS_AGO = 3

// Официальный курс ЦБ РФ.
const CBR_CURRENT_URL = "https://www.cbr-xml-daily.ru/daily_json.js"
const CBR_ARCHIVE_URL = "https://www.cbr-xml-daily.ru/archive/"
const CBR_BACKFILL_DAYS = 14

// Тариф DeepSeek: дорогие окна в UTC, Пн–Пт, кроме праздников КНР.
const PEAK_WINDOWS = [
  [1, 4],
  [6, 10],
]

// Праздники КНР на 2026 год (в эти дни тариф дешёвый весь день).
const CN_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19",
  "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
  "2026-10-06", "2026-10-07",
])

const Status = Ipc.define({
  id: "deepseek-balance.status",
  state: Schema.Struct({
    label: Schema.String,
    detail: Schema.String,
    ok: Schema.Boolean,
    rate: Schema.Number,
    rub: Schema.Number,
    rubPrev: Schema.Number,
    rubPrevDate: Schema.String,
    rubPrevSeed: Schema.Boolean,
    rubChange: Schema.Number,
    rubPct: Schema.Number,
    rubForecast: Schema.Number,
    rubTrend: Schema.Number,
    rubUpdated: Schema.String,
    chart: Schema.String,
    chartFrom: Schema.String,
    chartTo: Schema.String,
    chartCount: Schema.Number,
    chartMin: Schema.Number,
    chartMax: Schema.Number,
    chartData: Schema.String,
    rubMarkup: Schema.Number,
    rubMarkupPrev: Schema.Number,
    rubMarkupPct: Schema.Number,
    rubMarkupDate: Schema.String,
    cbr: Schema.Number,
    cbrPrev: Schema.Number,
    cbrPrevDate: Schema.String,
    cbrChange: Schema.Number,
    cbrPct: Schema.Number,
    cbrForecast: Schema.Number,
    cbrTrend: Schema.Number,
    cbrDate: Schema.String,
    cbrChart: Schema.String,
    cbrChartFrom: Schema.String,
    cbrChartTo: Schema.String,
    cbrChartCount: Schema.Number,
    cbrChartMin: Schema.Number,
    cbrChartMax: Schema.Number,
    cbrChartData: Schema.String,
    version: Schema.String,
    latestVersion: Schema.String,
    updateAvailable: Schema.Boolean,
    updateChecking: Schema.Boolean,
    updateUrl: Schema.String,
    updateNotes: Schema.String,
    updateCheckedAt: Schema.String,
    updateError: Schema.String,
  }),
  methods: {
    refresh: {},
    checkUpdate: {},
  },
})

const BALANCE_RE =
  /^\s*([A-Z]{3})\s+([0-9]+(?:\.[0-9]+)?)\s+\(topped up:\s*([0-9.]+),\s*granted:\s*([0-9.]+)\)/gm

function parseBalances(text) {
  const out = []
  let match

  BALANCE_RE.lastIndex = 0
  while ((match = BALANCE_RE.exec(text || ""))) {
    out.push({
      currency: match[1],
      total: match[2],
      toppedUp: match[3],
      granted: match[4],
    })
  }

  return out
}

function buildLabel(text) {
  const balances = parseBalances(text)
  if (balances.length === 0) return null

  const main = balances[0]
  const sign =
    main.currency === "CNY" ? "¥" : main.currency === "USD" ? "$" : main.currency === "EUR" ? "€" : `${main.currency} `
  return `DS ${sign}${main.total}`
}

function sessionCost(session) {
  try {
    const data = session?.server?.data
    if (!data) return null

    const value = data.session.cost(session.id)
    if (typeof value === "number" && Number.isFinite(value)) return value

    const stored = data.session.get(session.id)?.cost
    return typeof stored === "number" && Number.isFinite(stored) ? stored : null
  } catch {
    return null
  }
}

function formatCny(usd, rate) {
  const value = usd * rate
  if (!Number.isFinite(value) || value <= 0) return "¥0.00"
  return `¥${value >= 0.1 ? value.toFixed(2) : value.toFixed(3)}`
}

function formatRubAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "0,00 ₽"
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
}

function formatMoney(value, currency) {
  const n = Number(value)
  if (!Number.isFinite(n)) return currency === "RUB" ? "0,00 ₽" : "¥0.00"
  if (currency === "RUB") return formatRubAmount(n)
  return `¥${n >= 0.1 ? n.toFixed(2) : n.toFixed(3)}`
}

function formatMoneyShort(value, currency) {
  const n = Number(value)
  if (!Number.isFinite(n)) return currency === "RUB" ? "0 ₽" : "¥0.00"
  if (currency === "RUB") return `${Math.round(n).toLocaleString("ru-RU")} ₽`
  return `¥${n >= 0.1 ? n.toFixed(2) : n.toFixed(3)}`
}

function sessionDailySpend(session) {
  const days = 14

  try {
    const data = session?.server?.data
    if (!data) return []

    const messages = data.session.message.list(session.id) ?? []
    const byDay = new Map()

    for (const message of messages) {
      const info = message && message.info ? message.info : message
      if (!info || info.type !== "assistant") continue

      const cost = Number(info.cost)
      const created = info.time && info.time.created
      if (!Number.isFinite(cost) || cost <= 0 || !created) continue

      const key = localDateKey(new Date(created))
      byDay.set(key, (byDay.get(key) || 0) + cost)
    }

    const out = []
    const today = new Date()

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const key = localDateKey(date)
      out.push({ date: key, usd: byDay.get(key) || 0 })
    }

    return out
  } catch {
    return []
  }
}

function sessionSpendToday(daily) {
  const today = localDateKey(new Date())
  const point = (daily || []).find((item) => item.date === today)
  return point ? point.usd : 0
}

const SPARK_CHARS = "▁▂▃▄▅▆▇█"

function sparkline(values, allowZero) {
  const list = (values || []).filter(
    (value) => Number.isFinite(value) && (allowZero ? value >= 0 : value > 0),
  )
  if (list.length === 0) return ""

  const min = Math.min(...list)
  const max = Math.max(...list)
  if (max === min) return SPARK_CHARS[3].repeat(list.length)

  return list
    .map((value) => {
      const index = Math.round(((value - min) / (max - min)) * (SPARK_CHARS.length - 1))
      return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, index))]
    })
    .join("")
}

function buildChart(points) {
  const list = (points || [])
    .filter((point) => point && point.date && Number.isFinite(point.rate) && point.rate > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0))
    .slice(-20)

  if (list.length === 0) {
    return { chart: "", chartFrom: "", chartTo: "", chartCount: 0, chartMin: 0, chartMax: 0, chartData: "[]" }
  }

  const rates = list.map((point) => point.rate)

  return {
    chart: sparkline(rates),
    chartFrom: list[0].date,
    chartTo: list[list.length - 1].date,
    chartCount: list.length,
    chartMin: Math.min(...rates),
    chartMax: Math.max(...rates),
    chartData: JSON.stringify(
      list.map((point) => ({ date: point.date, rate: point.rate, ts: point.ts || 0 })),
    ),
  }
}

function chartFields(points, prefix) {
  const chart = buildChart(points)

  if (!prefix) {
    return {
      chart: chart.chart,
      chartFrom: chart.chartFrom,
      chartTo: chart.chartTo,
      chartCount: chart.chartCount,
      chartMin: chart.chartMin,
      chartMax: chart.chartMax,
      chartData: chart.chartData,
    }
  }

  return {
    [`${prefix}Chart`]: chart.chart,
    [`${prefix}ChartFrom`]: chart.chartFrom,
    [`${prefix}ChartTo`]: chart.chartTo,
    [`${prefix}ChartCount`]: chart.chartCount,
    [`${prefix}ChartMin`]: chart.chartMin,
    [`${prefix}ChartMax`]: chart.chartMax,
    [`${prefix}ChartData`]: chart.chartData,
  }
}

const chartCache = new Map()
let chartTooltip = null

function ensureChartTooltip() {
  if (typeof document === "undefined" || !document.body) return null
  if (chartTooltip && document.body.contains(chartTooltip)) return chartTooltip

  chartTooltip = document.createElement("div")
  chartTooltip.style.cssText = [
    "position: fixed",
    "z-index: 2147483647",
    "pointer-events: none",
    "display: none",
    "max-width: 280px",
    "padding: 5px 8px",
    "border-radius: 6px",
    "background: rgba(17, 24, 39, 0.96)",
    "color: #fff",
    "font: 12px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif",
    "box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28)",
    "white-space: nowrap",
  ].join(";")

  document.body.appendChild(chartTooltip)
  return chartTooltip
}

function positionChartTooltip(x, y) {
  const tip = chartTooltip
  if (!tip) return

  const pad = 12
  const width = tip.offsetWidth || 0
  const height = tip.offsetHeight || 0
  let left = x + pad
  let top = y - height - pad

  if (left + width > window.innerWidth - 8) left = x - width - pad
  if (left < 8) left = 8
  if (top < 8) top = y + pad

  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
}

function showChartTooltip(text, x, y) {
  const tip = ensureChartTooltip()
  if (!tip) return

  tip.textContent = text
  tip.style.display = "block"
  positionChartTooltip(x, y)
}

function hideChartTooltip() {
  if (chartTooltip) chartTooltip.style.display = "none"
}

function setChartPoints(key, value, digits, showTime, unit, allowZero) {
  try {
    const data = JSON.parse(value || "[]")
    if (Array.isArray(data) && data.length > 0) {
      chartCache.set(key, {
        points: data,
        digits,
        showTime,
        unit: unit || "₽",
        allowZero: !!allowZero,
      })
    } else {
      chartCache.delete(key)
    }
  } catch {
    chartCache.delete(key)
  }
}

function chartPointTitle(point, digits, showTime, unit) {
  const time =
    showTime && point.ts
      ? new Date(point.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
      : ""
  return `${formatShortDate(point.date)}${time ? ` ${time}` : ""}: ${formatPrice(point.rate, digits)} ${unit || "₽"}`
}

function parseAmount(value) {
  const n = Number(String(value == null ? "" : value).replace(",", "."))
  return Number.isFinite(n) ? n : NaN
}

function formatRub(value, digits) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return "—"
  return n.toFixed(digits === undefined ? 0 : digits).replace(".", ",")
}

function formatPrice(value, digits) {
  const text = formatRub(value, digits)
  return text.includes(",") ? text.replace(/,?0+$/, "") : text
}

function formatNumber(value, digits) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "—"
  return n.toFixed(digits === undefined ? 0 : digits).replace(".", ",")
}

function formatPct(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "0%"
  const abs = Math.abs(n).toFixed(1).replace(".", ",")
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${abs}%`
}

function rateArrow(pct) {
  if (pct > 0.05) return "▲"
  if (pct < -0.05) return "▼"
  return "="
}

function compareVersions(a, b) {
  const pa = String(a || "")
    .replace(/^v/i, "")
    .split(".")
    .map((value) => parseInt(value, 10) || 0)
  const pb = String(b || "")
    .replace(/^v/i, "")
    .split(".")
    .map((value) => parseInt(value, 10) || 0)
  const length = Math.max(pa.length, pb.length)

  for (let i = 0; i < length; i++) {
    const left = pa[i] || 0
    const right = pb[i] || 0
    if (left > right) return 1
    if (left < right) return -1
  }

  return 0
}

function localDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function formatShortDate(key) {
  if (!key || key.length < 10) return ""
  return `${key.slice(8, 10)}.${key.slice(5, 7)}`
}

function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
}

function computeRateStats(points) {
  const list = (points || [])
    .filter((point) => point && point.date && Number.isFinite(point.rate) && point.rate > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))

  if (list.length === 0) {
    return {
      current: 0,
      prev: 0,
      prevDate: "",
      prevSeed: false,
      change: 0,
      pct: 0,
      forecast: 0,
      trend: 0,
      count: 0,
    }
  }

  const last = list[list.length - 1]
  const prev = list.length > 1 ? list[list.length - 2] : null
  const change = prev ? last.rate - prev.rate : 0
  const pct = prev && prev.rate > 0 ? (change / prev.rate) * 100 : 0

  let forecast = 0
  let trend = 0

  if (list.length >= 2) {
    const recent = list.slice(-7)
    const base = Date.parse(`${recent[0].date}T00:00:00`)
    const xs = recent.map((point) => (Date.parse(`${point.date}T00:00:00`) - base) / 86400000)
    const ys = recent.map((point) => point.rate)
    const n = recent.length
    const sx = xs.reduce((sum, value) => sum + value, 0)
    const sy = ys.reduce((sum, value) => sum + value, 0)
    const sxx = xs.reduce((sum, value) => sum + value * value, 0)
    const sxy = xs.reduce((sum, value, index) => sum + value * ys[index], 0)
    const denom = n * sxx - sx * sx

    if (denom !== 0) {
      trend = (n * sxy - sx * sy) / denom
      const intercept = (sy - trend * sx) / n
      forecast = intercept + trend * (xs[n - 1] + 1)
    } else {
      forecast = last.rate
    }

    if (!Number.isFinite(forecast) || forecast <= 0) forecast = last.rate
    if (!Number.isFinite(trend)) trend = 0
  }

  return {
    current: last.rate,
    prev: prev ? prev.rate : 0,
    prevDate: prev ? prev.date : "",
    prevSeed: prev ? !!prev.seed : false,
    change,
    pct,
    forecast,
    trend,
    count: list.length,
  }
}

function computeMarkupHistory(platiPoints, cbrPoints) {
  const plati = (platiPoints || [])
    .filter((point) => point && point.date && Number.isFinite(point.rate) && point.rate > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
  const cbr = (cbrPoints || [])
    .filter((point) => point && point.date && Number.isFinite(point.rate) && point.rate > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))

  const out = []

  for (const point of plati) {
    let official = 0
    for (const rate of cbr) {
      if (rate.date <= point.date) official = rate.rate
      else break
    }
    if (official > 0) out.push({ date: point.date, markup: point.rate / official })
  }

  return out
}

function computeMarkupStats(points) {
  const list = (points || [])
    .filter((point) => point && point.date && Number.isFinite(point.markup) && point.markup > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))

  if (list.length === 0) {
    return { current: 0, prev: 0, pct: 0, prevDate: "" }
  }

  const last = list[list.length - 1]
  const prev = list.length > 1 ? list[list.length - 2] : null
  const pct = prev && prev.markup > 0 ? ((last.markup - prev.markup) / prev.markup) * 100 : 0

  return {
    current: last.markup,
    prev: prev ? prev.markup : 0,
    pct,
    prevDate: prev ? prev.date : "",
  }
}

function adviceLabel(state) {
  if (!(state.rub > 0)) return "Курс ещё не загружен"
  if (!(state.rubForecast > 0)) return "Мало данных для прогноза"

  const diff = (state.rubForecast - state.rub) / state.rub
  if (diff > 0.005) return "Курс растёт — выгоднее пополнить сегодня"
  if (diff < -0.005) return "Курс снижается — можно подождать"
  return "Курс стабилен — можно не спешить"
}

function buildRows(state, usd, daily, todayUsd, display) {
  const rows = []
  const currency = display && display.currency === "RUB" ? "RUB" : "CNY"
  const setCurrency = display && typeof display.setCurrency === "function" ? display.setCurrency : null
  const canRub = state.cbr > 0 && state.rate > 0
  const useRub = currency === "RUB" && canRub
  const cnyToRub = canRub ? state.cbr / state.rate : 0
  const rate = useRub ? state.cbr : state.rate

  const balances = parseBalances(state.detail)
  const cnyBalance = balances.find((balance) => balance.currency === "CNY")

  if (useRub && cnyBalance) {
    const cny = Number(cnyBalance.total)
    rows.push({
      id: "balance",
      label: `Баланс: ${formatRubAmount(cny * cnyToRub)}`,
      detail: `¥${cny.toFixed(2)} · курс ${formatNumber(cnyToRub, 2)} ₽/¥ (ЦБ)`,
    })
  } else {
    for (const balance of balances) {
      rows.push({
        id: balance.currency,
        label: `${balance.currency} ${balance.total}`,
        detail: `пополнено ${balance.toppedUp} · бонусы ${balance.granted}`,
      })
    }
  }

  rows.push({
    id: "currency",
    label: useRub ? "Валюта: ₽ рубли" : "Валюта: ¥ юани",
    detail: useRub
      ? `курс ЦБ ${formatNumber(state.cbr, 2)} ₽/$ · нажмите для юаней`
      : canRub
        ? "нажмите, чтобы перевести в рубли"
        : "курс ЦБ ещё не загружен",
    run: canRub && setCurrency ? () => setCurrency(useRub ? "CNY" : "RUB") : undefined,
  })

  if (state.rate > 0 && usd !== null) {
    const sessionValue = usd * rate
    const todayValue = (todayUsd || 0) * rate

    rows.push({
      id: "session",
      label: `Расход за всё время ≈ −${formatMoney(sessionValue, useRub ? "RUB" : "CNY")}`,
      detail: `$${usd.toFixed(4)} · сессия · ${useRub ? `курс ${formatNumber(state.cbr, 2)} ₽/$` : `фикс. курс ${state.rate.toFixed(4)}`}`,
    })
    rows.push({
      id: "today",
      label: `Сегодня ≈ −${formatMoney(todayValue, useRub ? "RUB" : "CNY")}`,
      detail: `за ${formatShortDate(localDateKey(new Date()))} · по сообщениям сессии`,
    })
  }

  if (daily && daily.length > 0) {
    const total = daily.reduce((sum, point) => sum + point.usd, 0)
    const chart = sparkline(daily.map((point) => point.usd * rate), true)

    if (total > 0 && chart) {
      const spendDays = daily.filter((point) => point.usd > 0).slice(-3)
      const summary = spendDays
        .map(
          (point) =>
            `${formatShortDate(point.date)}: ${formatMoney(point.usd * rate, useRub ? "RUB" : "CNY")}`,
        )
        .join(" · ")

      rows.push({
        id: "session-chart",
        label: chart,
        detail: summary ? `расход по дням · ${summary}` : `расход по дням · ${daily.length} дн.`,
      })
    }
  }

  rows.push({
    id: "refresh",
    label: "Обновить",
    run: () => {
      if (typeof state.refresh === "function") void state.refresh()
    },
  })

  return rows
}

function dateKeyUTC(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function isPeakDay(date) {
  const day = date.getUTCDay()
  if (day === 0 || day === 6) return false
  return !CN_HOLIDAYS.has(dateKeyUTC(date))
}

function isPeakTime(date) {
  if (!isPeakDay(date)) return false

  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  return PEAK_WINDOWS.some(([start, end]) => hour >= start && hour < end)
}

function peakBoundaries(now, days) {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const out = []

  for (let i = 0; i < days; i++) {
    const dayStart = base + i * 86400000
    const day = new Date(dayStart)
    if (!isPeakDay(day)) continue

    for (const [start, end] of PEAK_WINDOWS) {
      out.push(new Date(dayStart + start * 3600000))
      out.push(new Date(dayStart + end * 3600000))
    }
  }

  return out.sort((a, b) => a - b)
}

function upcomingBoundaries(now, count) {
  const result = []

  for (const boundary of peakBoundaries(now, 12)) {
    if (boundary.getTime() > now.getTime()) {
      result.push(boundary)
      if (result.length >= count) break
    }
  }

  return result
}

function formatDuration(ms, compact) {
  const total = Math.max(0, Math.round(ms / 60000))
  if (total < 1) return "<1м"

  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const minutes = total % 60
  const sep = compact ? "" : " "

  if (days > 0) return `${days}д${sep}${hours}ч`
  if (hours > 0) return `${hours}ч${sep}${String(minutes).padStart(2, "0")}м`
  return `${minutes}м`
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function formatWhen(date, now) {
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  const days = Math.round((startOfLocalDay(date) - startOfLocalDay(now)) / 86400000)

  if (days === 0) return time
  if (days === 1) return `завтра ${time}`
  if (days === 2) return `послезавтра ${time}`

  const day = date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
  return `${day} ${time}`
}

function localPeakWindows(now) {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  return PEAK_WINDOWS.map(([start, end]) => {
    const from = new Date(base + start * 3600000)
    const to = new Date(base + end * 3600000)
    const a = from.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    const b = to.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    return `${a}–${b}`
  }).join(", ")
}

function computeTariff(nowMs) {
  const now = new Date(nowMs)
  const peak = isPeakTime(now)
  const [next, after] = upcomingBoundaries(now, 2)

  const untilNext = next ? next.getTime() - now.getTime() : 0
  const untilAfter = after ? after.getTime() - now.getTime() : 0

  const label = `${peak ? "дор." : "деш."} ${formatDuration(untilNext, true)}`

  const title = next
    ? peak
      ? `Сейчас дорогой тариф · дешёвый с ${formatWhen(next, now)} (через ${formatDuration(untilNext)})`
      : `Сейчас дешёвый тариф · дорогой с ${formatWhen(next, now)} (через ${formatDuration(untilNext)})`
    : "Тариф DeepSeek"

  const rows = [
    {
      id: "now",
      label: peak ? "Сейчас дорогой тариф" : "Сейчас дешёвый тариф",
      detail: next ? `до ${formatWhen(next, now)}` : "",
    },
  ]

  if (next) {
    rows.push({
      id: "next",
      label: peak
        ? `Дешёвый через ${formatDuration(untilNext)}`
        : `Дорогой через ${formatDuration(untilNext)}`,
      detail: `с ${formatWhen(next, now)}`,
    })
  }

  if (after) {
    rows.push({
      id: "after",
      label: peak
        ? `Следующее дорогое через ${formatDuration(untilAfter)}`
        : `Снова дешёвый через ${formatDuration(untilAfter)}`,
      detail: `с ${formatWhen(after, now)}`,
    })
  }

  rows.push({
    id: "windows",
    label: "Дорогие окна",
    detail: `${localPeakWindows(now)} · Пн–Пт, кроме праздников КНР`,
  })

  return {
    peak,
    label,
    title,
    rows,
  }
}

const definition = Plugin.define({
  setup(ctx) {
    const client = ctx.main(Status)
    const [now, setNow] = createSignal(Date.now())
    const [displayCurrency, setDisplayCurrency] = createSignal("CNY")
    const tick = setInterval(() => setNow(Date.now()), 15000)

    try {
      ctx.add(Style, PILL_STYLE)
    } catch (error) {
      console.error("deepseek-balance: style registration failed", error)
    }

    let chartObserver
    let chartTimer

    const decorateChartRow = (row, datasetKey, dataset) => {
      const points = dataset.points || []
      const expected = sparkline(points.map((point) => point.rate), dataset.allowZero)
      if (!expected) return

      const signature = `${datasetKey}|${expected}|${points
        .map((point) => `${point.date}:${point.rate}:${point.ts || 0}`)
        .join(",")}`

      const spans = Array.from(row.querySelectorAll("span"))
      let label = spans.find((span) => (span.textContent || "").trim() === expected)

      if (!label && datasetKey === "session") {
        const first = row.firstElementChild
        if (first && first.tagName === "SPAN" && !(first.textContent || "").includes("расход по дням")) {
          label = first
        }
      }

      if (!label) return
      if (label.dataset.chartDecorated === signature && label.children.length === points.length) return

      label.textContent = ""
      points.forEach((point, index) => {
        const span = document.createElement("span")
        const title = chartPointTitle(point, dataset.digits, dataset.showTime, dataset.unit)

        span.textContent = expected[index] || ""
        span.setAttribute("aria-label", title)
        span.addEventListener("mouseenter", (event) =>
          showChartTooltip(title, event.clientX, event.clientY),
        )
        span.addEventListener("mousemove", (event) =>
          positionChartTooltip(event.clientX, event.clientY),
        )
        span.addEventListener("mouseleave", hideChartTooltip)
        span.style.display = "inline-block"
        span.style.minWidth = "7px"
        span.style.textAlign = "center"
        span.style.cursor = "help"
        label.appendChild(span)
      })
      label.dataset.chartDecorated = signature
    }

    const decorateChart = () => {
      if (typeof document === "undefined") return

      if (chartCache.size === 0) {
        hideChartTooltip()
        return
      }

      const menus = document.querySelectorAll('[data-slot="session-plugin-pill-menu"]')
      if (!menus || menus.length === 0) {
        hideChartTooltip()
        return
      }

      for (const menu of menus) {
        const rows = menu.querySelectorAll('[data-slot="session-plugin-pill-row"]')

        for (const row of rows) {
          const text = (row.textContent || "").toLowerCase()

          if (text.includes("расход по дням")) {
            const dataset = chartCache.get("session")
            if (dataset) decorateChartRow(row, "session", dataset)
            continue
          }

          if (text.includes("график plati")) {
            const dataset = chartCache.get("plati")
            if (dataset) decorateChartRow(row, "plati", dataset)
            continue
          }

          if (text.includes("график цб")) {
            const dataset = chartCache.get("cbr")
            if (dataset) decorateChartRow(row, "cbr", dataset)
            continue
          }

          for (const [datasetKey, dataset] of chartCache.entries()) {
            const expected = sparkline(
              (dataset.points || []).map((point) => point.rate),
              dataset.allowZero,
            )
            if (!expected) continue

            const spans = Array.from(row.querySelectorAll("span"))
            if (spans.some((span) => (span.textContent || "").trim() === expected)) {
              decorateChartRow(row, datasetKey, dataset)
              break
            }
          }
        }
      }
    }

    const scheduleChartDecor = () => {
      if (chartTimer) return
      chartTimer = setTimeout(() => {
        chartTimer = undefined
        decorateChart()
      }, 120)
    }

    if (typeof document !== "undefined" && document.body && typeof MutationObserver !== "undefined") {
      chartObserver = new MutationObserver(scheduleChartDecor)
      chartObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      decorateChart()
    }

    const hideOnLeave = () => hideChartTooltip()

    if (typeof document !== "undefined") {
      document.addEventListener("mouseleave", hideOnLeave)
      document.addEventListener("mousedown", hideOnLeave, true)
    }
    if (typeof window !== "undefined") {
      window.addEventListener("blur", hideOnLeave)
    }

    try {
      ctx.add(Command, () => ({
        id: "refresh",
        title: "Обновить остаток DeepSeek",
        group: "DeepSeek",
        run: () => {
          void client.refresh().catch(() => {})
        },
      }))
    } catch (error) {
      console.error("deepseek-balance: command registration failed", error)
    }

    try {
      ctx.add(ComposerPill, {
        id: "balance",
        order: 100,
        show(input) {
          const state = client.state()

          if (!state) {
            return {
              label: "DS …",
              icon: "status",
              title: "Остаток DeepSeek API загружается",
            }
          }

          const usd = sessionCost(input.session)
          const daily = sessionDailySpend(input.session)
          const todayUsd = sessionSpendToday(daily)
          const canRub = state.cbr > 0 && state.rate > 0
          const useRub = displayCurrency() === "RUB" && canRub
          const currency = useRub ? "RUB" : "CNY"
          const rate = useRub ? state.cbr : state.rate

          const balances = parseBalances(state.detail)
          const cnyBalance = Number(
            (balances.find((balance) => balance.currency === "CNY") || {}).total || 0,
          )
          const cnyToRub = canRub ? state.cbr / state.rate : 0
          const balanceLabel =
            useRub && cnyBalance > 0
              ? `DS ${formatMoneyShort(cnyBalance * cnyToRub, "RUB")}`
              : state.label

          const spend = state.rate > 0 && usd !== null ? `−${formatMoney(usd * rate, currency)}` : null
          const today = state.rate > 0 && usd !== null ? `−${formatMoney(todayUsd * rate, currency)}` : null
          const spendShort =
            state.rate > 0 && usd !== null ? `−${formatMoneyShort(usd * rate, currency)}` : null
          const todayShort =
            state.rate > 0 && usd !== null ? `−${formatMoneyShort(todayUsd * rate, currency)}` : null
          const label = [balanceLabel, spendShort, todayShort].filter(Boolean).join(" · ")
          const chartUnit = useRub ? "₽" : "¥"

          if (state.rate > 0 && daily.length > 0) {
            setChartPoints(
              "session",
              JSON.stringify(
                daily.map((point) => ({
                  date: point.date,
                  rate: point.usd * rate,
                  ts: 0,
                })),
              ),
              2,
              false,
              chartUnit,
              true,
            )
          } else {
            setChartPoints("session", "[]", 2, false, chartUnit, true)
          }

          const rows = buildRows(
            { ...state, refresh: () => client.refresh() },
            usd,
            daily,
            todayUsd,
            { currency, setCurrency: setDisplayCurrency },
          )

          rows.unshift({
            id: "version",
            label: `Версия плагина: ${state.version || PLUGIN_VERSION}`,
            detail: state.updateChecking
              ? "проверяем обновление…"
              : state.updateError
                ? "проверка не удалась"
                : state.updateAvailable
                  ? `доступна ${state.latestVersion}`
                  : state.updateCheckedAt
                    ? "обновлений нет"
                    : "проверка ещё не выполнялась",
          })

          if (state.updateAvailable) {
            rows.push({
              id: "update-available",
              label: `Обновить до ${state.latestVersion}`,
              detail: state.updateNotes || "открыть страницу загрузки",
              run: () =>
                openExternalUrl(
                  ctx,
                  state.updateUrl ||
                    "https://github.com/i-lednev/opencode-deepseek-pills/releases/latest",
                ),
            })
          }

          rows.push({
            id: "check-update",
            label: state.updateChecking ? "Проверяем обновление…" : "Проверить обновление",
            detail: state.updateError ? `ошибка: ${state.updateError}` : "",
            run: () => void client.checkUpdate().catch(() => {}),
          })

          return {
            label,
            icon: "status",
            tone: state.ok ? undefined : "danger",
            title: spend
              ? `${balanceLabel} · расход за всё время ${spend} · сегодня ${today}`
              : balanceLabel,
            rows,
          }
        },
      })
    } catch (error) {
      console.error("deepseek-balance: composer pill registration failed", error)
    }

    try {
      ctx.add(ComposerPill, {
        id: "tariff",
        order: 101,
        show() {
          const tariff = computeTariff(now())

          return {
            label: tariff.label,
            icon: "status",
            tone: tariff.peak ? "warning" : "success",
            title: tariff.title,
            rows: tariff.rows,
          }
        },
      })
    } catch (error) {
      console.error("deepseek-balance: tariff pill registration failed", error)
    }

    try {
      ctx.add(ComposerPill, {
        id: "topup",
        order: 102,
        show() {
          const state = client.state()
          setChartPoints("plati", state ? state.chartData : "[]", 2, true)

          if (!state || !(state.rub > 0)) {
            return {
              label: "курс …",
              icon: "status",
              title: "Курс пополнения DeepSeek загружается",
            }
          }

          const hasPrev = state.rubPrev > 0
          const pctText =
            hasPrev && Math.abs(state.rubPct) >= 0.05
              ? `${rateArrow(state.rubPct)}${Math.abs(state.rubPct).toFixed(1).replace(".", ",")}%`
              : hasPrev
                ? "="
                : ""
          const forecastText = state.rubForecast > 0 ? ` ~${formatRub(state.rubForecast, 0)}` : ""
          const markupArrow =
            state.rubMarkupPct > 0.5 ? "↑" : state.rubMarkupPct < -0.5 ? "↓" : ""
          const markupText =
            state.rubMarkup > 0
              ? ` ×${state.rubMarkup.toFixed(2).replace(".", ",")}${markupArrow}`
              : ""

          const label = `${formatRub(state.rub, 0)}₽${pctText ? ` ${pctText}` : ""}${markupText}${forecastText}`

          const rows = [
            {
              id: "now",
              label: `Сейчас: ${formatRub(state.rub, 2)} ₽ за $1`,
              detail: state.rubUpdated ? `обновлено ${formatTime(state.rubUpdated)}` : "",
            },
          ]

          if (hasPrev) {
            rows.push({
              id: "prev",
              label: `Было: ${formatRub(state.rubPrev, 2)} ₽`,
              detail: `${formatShortDate(state.rubPrevDate)} · ${formatPct(state.rubPct)}${state.rubPrevSeed ? " · по вашим данным" : ""}`,
            })
          }

          if (state.chart && state.chartCount > 0) {
            const chartDetail =
              state.chartFrom && state.chartTo && state.chartFrom !== state.chartTo
                ? `${formatShortDate(state.chartFrom)} → ${formatShortDate(state.chartTo)}`
                : formatShortDate(state.chartTo)
            rows.push({
              id: "chart",
              label: state.chart,
              detail: chartDetail,
              run: () => {},
            })
            rows.push({
              id: "chart-stats",
              label: `График plati: ${state.chartCount} знач. · ${formatRub(state.chartMin, 0)}–${formatRub(state.chartMax, 0)} ₽`,
              detail: "до 20 значений",
            })
          }

          if (state.rubMarkup > 0) {
            const markupDetail =
              state.rubMarkupPrev > 0
                ? `${formatShortDate(state.rubMarkupDate)}: ×${formatNumber(state.rubMarkupPrev, 2)} · ${formatPct(state.rubMarkupPct)}`
                : "история наценки копится"
            rows.push({
              id: "markup",
              label: `Наценка: ×${formatNumber(state.rubMarkup, 2)}`,
              detail: `к ЦБ РФ · ${markupDetail}`,
            })
          }

          if (state.rubForecast > 0) {
            const trendSign = state.rubTrend > 0 ? "+" : state.rubTrend < 0 ? "-" : ""
            rows.push({
              id: "forecast",
              label: `Прогноз завтра: ~${formatRub(state.rubForecast, 0)} ₽`,
              detail: `тренд ${trendSign}${formatNumber(Math.abs(state.rubTrend), 1)} ₽/день · не гарантия`,
            })
          }

          rows.push({
            id: "advice",
            label: adviceLabel(state),
            detail: "оценка по тренду, не финансовый совет",
          })
          rows.push({
            id: "buy",
            label: "Купить на plati.market",
            detail: "открыть ↗",
            run: () => openPlati(ctx),
          })
          rows.push({
            id: "source",
            label: "Источник: plati.market",
            detail: "The Cheap One · 1 $ баланса DeepSeek",
          })
          rows.push({
            id: "refresh",
            label: "Обновить",
            run: () => void client.refresh().catch(() => {}),
          })

          const prevText = hasPrev
            ? `ранее ${formatRub(state.rubPrev, 0)} ₽ (${formatShortDate(state.rubPrevDate)})`
            : "предыдущего значения нет"
          const forecastTitle =
            state.rubForecast > 0 ? `прогноз завтра ~${formatRub(state.rubForecast, 0)} ₽` : "прогноза пока нет"
          const markupTitle =
            state.rubMarkup > 0 ? ` · наценка ×${formatNumber(state.rubMarkup, 2)}` : ""

          return {
            label,
            icon: "status",
            tone: state.rubChange > 0 ? "danger" : state.rubChange < 0 ? "success" : undefined,
            title: `Пополнение DeepSeek: ${formatRub(state.rub, 2)} ₽ за $1 · ${prevText}${markupTitle} · ${forecastTitle}`,
            rows,
          }
        },
      })
    } catch (error) {
      console.error("deepseek-balance: topup pill registration failed", error)
    }

    try {
      ctx.add(ComposerPill, {
        id: "cbr",
        order: 103,
        show() {
          const state = client.state()
          setChartPoints("cbr", state ? state.cbrChartData : "[]", 4, false)

          if (!state || !(state.cbr > 0)) {
            return {
              label: "ЦБ …",
              icon: "status",
              title: "Официальный курс ЦБ РФ загружается",
            }
          }

          const hasPrev = state.cbrPrev > 0
          const pctText =
            hasPrev && Math.abs(state.cbrPct) >= 0.01
              ? `${rateArrow(state.cbrPct)}${Math.abs(state.cbrPct).toFixed(2).replace(".", ",")}%`
              : hasPrev
                ? "="
                : ""
          const forecastText =
            state.cbrForecast > 0 ? ` ~${formatNumber(state.cbrForecast, 1)}` : ""

          const label = `${formatNumber(state.cbr, 2)}₽${pctText ? ` ${pctText}` : ""}${forecastText}`

          const rows = [
            {
              id: "now",
              label: `Официальный USD/RUB: ${formatNumber(state.cbr, 4)}`,
              detail: state.cbrDate ? `на ${formatShortDate(state.cbrDate)}` : "",
            },
          ]

          if (hasPrev) {
            rows.push({
              id: "prev",
              label: `Было: ${formatNumber(state.cbrPrev, 4)}`,
              detail: `${formatShortDate(state.cbrPrevDate)} · ${formatPct(state.cbrPct)}`,
            })
          }

          if (state.cbrChart && state.cbrChartCount > 0) {
            const chartDetail =
              state.cbrChartFrom && state.cbrChartTo && state.cbrChartFrom !== state.cbrChartTo
                ? `${formatShortDate(state.cbrChartFrom)} → ${formatShortDate(state.cbrChartTo)}`
                : formatShortDate(state.cbrChartTo)
            rows.push({
              id: "chart",
              label: state.cbrChart,
              detail: chartDetail,
              run: () => {},
            })
            rows.push({
              id: "chart-stats",
              label: `График ЦБ: ${state.cbrChartCount} знач. · ${formatNumber(state.cbrChartMin, 2)}–${formatNumber(state.cbrChartMax, 2)} ₽`,
              detail: "до 20 значений",
            })
          }

          if (state.cbrForecast > 0) {
            const trendSign = state.cbrTrend > 0 ? "+" : state.cbrTrend < 0 ? "-" : ""
            rows.push({
              id: "forecast",
              label: `Прогноз завтра: ~${formatNumber(state.cbrForecast, 2)}`,
              detail: `тренд ${trendSign}${formatNumber(Math.abs(state.cbrTrend), 2)} ₽/день · не гарантия`,
            })
          }

          rows.push({
            id: "source",
            label: "Источник: ЦБ РФ",
            detail: "cbr-xml-daily.ru · официальный курс",
          })
          rows.push({
            id: "refresh",
            label: "Обновить",
            run: () => void client.refresh().catch(() => {}),
          })

          const prevText = hasPrev
            ? `ранее ${formatNumber(state.cbrPrev, 4)} (${formatShortDate(state.cbrPrevDate)})`
            : "предыдущего значения нет"
          const forecastTitle =
            state.cbrForecast > 0
              ? `прогноз завтра ~${formatNumber(state.cbrForecast, 2)}`
              : "прогноза пока нет"

          return {
            label,
            icon: "status",
            tone: state.cbrChange > 0 ? "danger" : state.cbrChange < 0 ? "success" : undefined,
            title: `Официальный USD/RUB: ${formatNumber(state.cbr, 4)} · ${prevText} · ${forecastTitle}`,
            rows,
          }
        },
      })
    } catch (error) {
      console.error("deepseek-balance: cbr pill registration failed", error)
    }

    return () => {
      clearInterval(tick)
      if (chartObserver) chartObserver.disconnect()
      if (chartTimer) clearTimeout(chartTimer)
      hideChartTooltip()
      if (typeof document !== "undefined") {
        document.removeEventListener("mouseleave", hideOnLeave)
        document.removeEventListener("mousedown", hideOnLeave, true)
      }
      if (typeof window !== "undefined") window.removeEventListener("blur", hideOnLeave)
      if (chartTooltip && chartTooltip.parentNode) chartTooltip.parentNode.removeChild(chartTooltip)
      chartTooltip = null
    }
  },

  main(ctx) {
    const { execFile } = require("node:child_process")
    const fs = require("node:fs")
    const os = require("node:os")
    const path = require("node:path")

    const script = path.join(
      process.env.USERPROFILE || "",
      ".config",
      "opencode",
      "scripts",
      "deepseek-balance.ps1",
    )
    const statusFile = path.join(os.tmpdir(), "opencode-deepseek-balance.json")
    const historyFile = path.join(
      process.env.USERPROFILE || "",
      ".local",
      "share",
      "opencode",
      "deepseek-balance-rate-history.json",
    )
    const cbrHistoryFile = path.join(
      process.env.USERPROFILE || "",
      ".local",
      "share",
      "opencode",
      "deepseek-balance-cbr-history.json",
    )

    function loadPlatiHistory() {
      try {
        const data = JSON.parse(fs.readFileSync(historyFile, "utf8"))
        if (data && Array.isArray(data.points) && data.points.length > 0) {
          return { points: data.points }
        }
      } catch {}

      const seedDate = new Date(Date.now() - RATE_SEED_DAYS_AGO * 86400000)
      return {
        points: [{ date: localDateKey(seedDate), rate: RATE_SEED_RATE, seed: true }],
      }
    }

    function savePlatiHistory() {
      try {
        fs.mkdirSync(path.dirname(historyFile), { recursive: true })
        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), "utf8")
      } catch {}
    }

    function recordRate(rate) {
      const today = localDateKey(new Date())
      const points = history.points
        .filter((point) => point && point.date && Number.isFinite(point.rate) && point.rate > 0)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0))
      const last = points[points.length - 1]
      const changed = !last || Math.abs(last.rate - rate) >= 0.0001
      const newDay = !last || last.date !== today

      // Каждое изменение курса — отдельная точка. Если курс за день не менялся,
      // добавляем одну дневную точку, чтобы график не пропускал дни.
      if (!changed && !newDay) {
        if (last) last.ts = Date.now()
        history.points = points.slice(-20)
        return
      }

      points.push({ date: today, rate, ts: Date.now(), seed: false })
      points.sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0))
      history.points = points.slice(-20)
    }

    function loadCbrHistory() {
      try {
        const data = JSON.parse(fs.readFileSync(cbrHistoryFile, "utf8"))
        if (data && Array.isArray(data.points)) return { points: data.points }
      } catch {}

      return { points: [] }
    }

    function saveCbrHistory() {
      try {
        fs.mkdirSync(path.dirname(cbrHistoryFile), { recursive: true })
        fs.writeFileSync(cbrHistoryFile, JSON.stringify(cbrHistory, null, 2), "utf8")
      } catch {}
    }

    function upsertCbr(point) {
      if (!point || !point.date || !Number.isFinite(point.rate) || point.rate <= 0) return false

      const points = cbrHistory.points.filter(
        (item) => item && item.date && Number.isFinite(item.rate) && item.rate > 0,
      )
      const existing = points.find((item) => item.date === point.date)

      if (existing) {
        existing.rate = point.rate
        existing.ts = point.ts || Date.now()
      } else {
        points.push({ ...point, ts: point.ts || Date.now() })
      }

      points.sort((a, b) => a.date.localeCompare(b.date))
      cbrHistory.points = points.slice(-120)
      return true
    }

    function rateFields() {
      const platiStats = computeRateStats(history.points)
      const cbrStats = computeRateStats(cbrHistory.points)
      const markupStats = computeMarkupStats(
        computeMarkupHistory(history.points, cbrHistory.points),
      )
      const lastPlati = history.points[history.points.length - 1]
      const lastCbr = cbrHistory.points[cbrHistory.points.length - 1]

      return {
        rub: platiStats.current,
        rubPrev: platiStats.prev,
        rubPrevDate: platiStats.prevDate,
        rubPrevSeed: platiStats.prevSeed,
        rubChange: platiStats.change,
        rubPct: platiStats.pct,
        rubForecast: platiStats.forecast,
        rubTrend: platiStats.trend,
        rubUpdated: lastPlati && lastPlati.ts ? new Date(lastPlati.ts).toISOString() : "",
        ...chartFields(history.points),
        ...chartFields(cbrHistory.points, "cbr"),
        rubMarkup: markupStats.current,
        rubMarkupPrev: markupStats.prev,
        rubMarkupPct: markupStats.pct,
        rubMarkupDate: markupStats.prevDate,
        cbr: cbrStats.current,
        cbrPrev: cbrStats.prev,
        cbrPrevDate: cbrStats.prevDate,
        cbrChange: cbrStats.change,
        cbrPct: cbrStats.pct,
        cbrForecast: cbrStats.forecast,
        cbrTrend: cbrStats.trend,
        cbrDate: lastCbr ? lastCbr.date : "",
      }
    }

    let history = loadPlatiHistory()
    let cbrHistory = loadCbrHistory()
    const initialRate = rateFields()

    let snapshot = {
      label: "DS …",
      detail: "Остаток DeepSeek API загружается",
      ok: true,
      rate: CNY_PER_USD,
      ...initialRate,
      version: PLUGIN_VERSION,
      latestVersion: "",
      updateAvailable: false,
      updateChecking: false,
      updateUrl: "",
      updateNotes: "",
      updateCheckedAt: "",
      updateError: "",
    }
    let provider
    let balanceTimer
    let rateTimer
    let cbrTimer
    let updateTimer

    function saveDebug() {
      try {
        fs.writeFileSync(
          statusFile,
          JSON.stringify({ at: new Date().toISOString(), ...snapshot }),
          "utf8",
        )
      } catch {}
    }

    function runBalance() {
      return new Promise((resolve) => {
        execFile(
          "powershell.exe",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
          { timeout: 30000, windowsHide: true },
          (error, stdout, stderr) => resolve({ error, stdout, stderr }),
        )
      })
    }

    async function refreshBalance() {
      const { error, stdout, stderr } = await runBalance()

      const text = String(stdout || "").trim()
      const label = error ? null : buildLabel(text)

      if (error || !label) {
        const reason =
          text ||
          String(stderr || "").trim() ||
          (error && error.message) ||
          "не удалось получить остаток"
        snapshot = { ...snapshot, label: "DS —", detail: reason, ok: false }
      } else {
        snapshot = {
          ...snapshot,
          label,
          detail: text,
          ok: !/Insufficient balance/i.test(text),
        }
      }

      provider.changed()
      saveDebug()
    }

    async function fetchCbrArchive(date) {
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, "0")
      const d = String(date.getDate()).padStart(2, "0")

      const response = await fetch(`${CBR_ARCHIVE_URL}${y}/${m}/${d}/daily_json.js`, {
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) return null

      const data = await response.json()
      const value = Number(data?.Valute?.USD?.Value)
      const effective = String(data?.Date || "").slice(0, 10)

      if (!Number.isFinite(value) || value <= 0 || !effective) return null
      return { date: effective, rate: value, ts: Date.now() }
    }

    async function refreshCbr() {
      try {
        const response = await fetch(CBR_CURRENT_URL, { signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data = await response.json()
        const value = Number(data?.Valute?.USD?.Value)
        const effective = String(data?.Date || "").slice(0, 10)
        if (!Number.isFinite(value) || value <= 0 || !effective) throw new Error("bad cbr")

        if (upsertCbr({ date: effective, rate: value, ts: Date.now() })) saveCbrHistory()
        snapshot = { ...snapshot, ...rateFields() }
      } catch {}

      provider.changed()
      saveDebug()
    }

    async function backfillCbr() {
      const existing = new Set(cbrHistory.points.map((point) => point.date))
      const today = new Date()
      let changed = false

      for (let i = 0; i < CBR_BACKFILL_DAYS; i++) {
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
        const key = localDateKey(date)
        if (existing.has(key)) continue

        try {
          const point = await fetchCbrArchive(date)
          if (point && !existing.has(point.date)) {
            if (upsertCbr(point)) {
              existing.add(point.date)
              changed = true
            }
          }
        } catch {}
      }

      if (changed) saveCbrHistory()
      snapshot = { ...snapshot, ...rateFields() }
      provider.changed()
      saveDebug()
    }

    async function refreshRate() {
      try {
        const response = await fetch(`${PLATI_PRICE_URL}${Math.random()}`, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "application/json",
            Cookie: "curr=RUR",
          },
          signal: AbortSignal.timeout(15000),
        })

        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data = await response.json()
        if (data.err && String(data.err) !== "0") throw new Error(`plati ${data.err}`)

        const rate = parseAmount(data.amount)
        if (!Number.isFinite(rate) || rate <= 0) throw new Error("bad amount")

        recordRate(rate)
        savePlatiHistory()
        snapshot = { ...snapshot, ...rateFields() }
      } catch {}

      provider.changed()
      saveDebug()
    }

    async function checkUpdate() {
      snapshot = { ...snapshot, updateChecking: true }
      provider.changed()

      try {
        const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, {
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
          },
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data = await response.json()
        const latest = String(data.version || data.latestVersion || "").trim()
        if (!latest) throw new Error("в манифесте нет версии")

        snapshot = {
          ...snapshot,
          latestVersion: latest,
          updateAvailable: compareVersions(latest, PLUGIN_VERSION) > 0,
          updateUrl: String(data.zip || data.url || "").trim(),
          updateNotes: String(data.notes || "").trim(),
          updateCheckedAt: new Date().toISOString(),
          updateError: "",
          updateChecking: false,
        }
      } catch (error) {
        snapshot = {
          ...snapshot,
          updateChecking: false,
          updateCheckedAt: new Date().toISOString(),
          updateError: String(error && error.message ? error.message : error),
        }
      }

      provider.changed()
      saveDebug()
    }

    function refreshAll() {
      return Promise.allSettled([refreshBalance(), refreshRate(), refreshCbr()])
    }

    provider = ctx.provide(Status, {
      state() {
        return snapshot
      },
      refresh() {
        return refreshAll()
      },
      checkUpdate() {
        return checkUpdate()
      },
    })

    void refreshBalance()
    void refreshRate()
    void (async () => {
      await backfillCbr()
      await refreshCbr()
    })()

    balanceTimer = setInterval(() => void refreshBalance(), 5 * 60 * 1000)
    rateTimer = setInterval(() => void refreshRate(), 30 * 60 * 1000)
    cbrTimer = setInterval(() => void refreshCbr(), 60 * 60 * 1000)
    setTimeout(() => void checkUpdate(), 3000)
    updateTimer = setInterval(() => void checkUpdate(), UPDATE_CHECK_INTERVAL)

    return () => {
      if (balanceTimer) clearInterval(balanceTimer)
      if (rateTimer) clearInterval(rateTimer)
      if (cbrTimer) clearInterval(cbrTimer)
      if (updateTimer) clearInterval(updateTimer)
    }
  },
})

module.exports = definition
module.exports.default = definition
