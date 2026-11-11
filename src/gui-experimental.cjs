"use strict"

const { ComposerPill, Command, Ipc, Plugin, Style } = require("@opencode/plugin/gui")
const { createEffect, createSignal } = require("solid-js")
const { Schema } = require("effect")

// Фиксированный курс пересчёта USD -> CNY.
// Измените это значение, если нужен другой курс.
const CNY_PER_USD = 6.6854

// Версия плагина и адрес манифеста обновлений на GitHub Pages.
const PLUGIN_VERSION = "1.3.4"
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
    updateSha: Schema.String,
    updating: Schema.Boolean,
    updateProgress: Schema.Number,
    updateMessage: Schema.String,
    updateFrom: Schema.String,
    updateTo: Schema.String,
    autoUpdate: Schema.Boolean,
  }),
  methods: {
    refresh: {},
    checkUpdate: {},
    installUpdate: {
      input: Schema.Struct({
        url: Schema.String,
        sha256: Schema.String,
        version: Schema.String,
      }),
    },
    toggleAutoUpdate: {},
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

function currencySymbol(currency) {
  if (currency === "RUB") return "₽"
  if (currency === "USD") return "$"
  return "¥"
}

function formatMoney(value, currency) {
  const n = Number(value)
  if (!Number.isFinite(n)) return currency === "RUB" ? "0,00 ₽" : `${currencySymbol(currency)}0.00`
  if (currency === "RUB") return formatRubAmount(n)
  if (currency === "USD") return `$${n.toFixed(2)}`
  return `¥${n >= 0.1 ? n.toFixed(2) : n.toFixed(3)}`
}

function formatMoneyShort(value, currency) {
  const n = Number(value)
  if (!Number.isFinite(n)) return currency === "RUB" ? "0 ₽" : `${currencySymbol(currency)}0.00`
  if (currency === "RUB") return `${Math.round(n).toLocaleString("ru-RU")} ₽`
  if (currency === "USD") return `$${n.toFixed(2)}`
  return `¥${n >= 0.1 ? n.toFixed(2) : n.toFixed(3)}`
}

function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} КБ`
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`
}

function sessionDailySpend(session) {
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

    return [...byDay.entries()]
      .filter(([, usd]) => usd > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-10)
      .map(([date, usd]) => ({ date, usd }))
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
  const label = point.total ? "Итого" : formatShortDate(point.date)
  return `${label}${time ? ` ${time}` : ""}: ${formatPrice(point.rate, digits)} ${unit || "₽"}`
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
  const order = ["RUB", "CNY", "USD"]
  const requested = display && order.includes(display.currency) ? display.currency : "CNY"
  const setCurrency = display && typeof display.setCurrency === "function" ? display.setCurrency : null
  const canRub = state.cbr > 0 && state.rate > 0
  const currency = requested === "RUB" && !canRub ? "CNY" : requested
  const cnyToRub = canRub ? state.cbr / state.rate : 0
  const cnyToUsd = state.rate > 0 ? 1 / state.rate : 0
  const rate = currency === "RUB" ? state.cbr : currency === "USD" ? 1 : state.rate
  const symbol = currencySymbol(currency)
  const next = order[(order.indexOf(currency) + 1) % order.length]

  const balances = parseBalances(state.detail)
  const cnyBalance = balances.find((balance) => balance.currency === "CNY")
  const cny = cnyBalance ? Number(cnyBalance.total) : 0

  if (cny > 0) {
    const value = currency === "RUB" ? cny * cnyToRub : currency === "USD" ? cny * cnyToUsd : cny
    const others = []

    if (currency !== "CNY") others.push(`¥${cny.toFixed(2)}`)
    if (currency !== "USD") others.push(`$${(cny * cnyToUsd).toFixed(2)}`)
    if (currency !== "RUB" && canRub) others.push(formatRubAmount(cny * cnyToRub))

    const rateText =
      currency === "RUB"
        ? `курс ${formatNumber(cnyToRub, 2)} ₽/¥ (ЦБ)`
        : currency === "USD"
          ? `курс ${formatNumber(state.rate, 4)} ¥/$`
          : ""

    rows.push({
      id: "balance",
      label: `Баланс: ${formatMoney(value, currency)}`,
      detail: [others.join(" · "), rateText].filter(Boolean).join(" · "),
    })
  } else {
    for (const balance of balances) {
      const symbol = balance.currency === "CNY" ? "¥" : balance.currency === "USD" ? "$" : balance.currency
      rows.push({
        id: balance.currency,
        label: `${symbol}${balance.total}`,
        detail: `пополнено ${balance.toppedUp} · бонусы ${balance.granted}`,
      })
    }
  }

  rows.push({
    id: "currency",
    label: `Валюта: ${symbol}`,
    detail: `${order.map(currencySymbol).join(" · ")} · нажмите для ${currencySymbol(next)}`,
    run: setCurrency ? () => setCurrency(next) : undefined,
  })

  if (state.rate > 0 && usd !== null) {
    const sessionValue = usd * rate
    const todayValue = (todayUsd || 0) * rate
    const rateText =
      currency === "RUB"
        ? `курс ${formatNumber(state.cbr, 2)} ₽/$`
        : currency === "USD"
          ? "в долларах"
          : `фикс. курс ${state.rate.toFixed(4)} ¥/$`

    rows.push({
      id: "session",
      label: `Расход за всё время ≈ −${formatMoney(sessionValue, currency)}`,
      detail: `$${usd.toFixed(4)} · сессия · ${rateText}`,
    })
    rows.push({
      id: "today",
      label: `Сегодня ≈ −${formatMoney(todayValue, currency)}`,
      detail: `за ${formatShortDate(localDateKey(new Date()))} · по сообщениям сессии`,
    })
  }

  if (daily && daily.length > 0) {
    const dailyOnly = daily.filter((point) => !point.total && point.usd > 0)
    const totalPoint = daily.find((point) => point.total)
    const chart = sparkline(daily.map((point) => point.usd * rate), false)

    if (chart) {
      const spendDays = dailyOnly.slice(-3)
      const summary = spendDays
        .map((point) => `${formatShortDate(point.date)}: ${formatMoney(point.usd * rate, currency)}`)
        .join(" · ")
      const totalText = totalPoint
        ? `Итого: ${formatMoney(totalPoint.usd * rate, currency)}`
        : ""
      const detail = [summary, totalText].filter(Boolean).join(" · ")

      rows.push({
        id: "session-chart",
        label: chart,
        detail: detail ? `расход по дням · ${detail}` : "расход по дням",
      })

      const historyPoints = dailyOnly.slice(-10)
      if (historyPoints.length > 0 || totalPoint) {
        const historyText = historyPoints
          .map(
            (point) =>
              `${formatShortDate(point.date)}: ${formatMoney(point.usd * rate, currency)}`,
          )
          .join(" · ")

        rows.push({
          id: "session-history",
          label: "История по дням",
          detail: [historyText, totalText].filter(Boolean).join(" · "),
        })
      }
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
    const [windowUpdate, setWindowUpdate] = createSignal({
      state: "idle",
      latest: "",
      available: false,
      notes: "",
      url: "",
      sha256: "",
      size: 0,
      checkedAt: "",
      error: "",
    })
    const [autoUpdateWindow, setAutoUpdateWindow] = createSignal(true)
    const [updateDismissed, setUpdateDismissed] = createSignal(false)
    const [sessionHistory, setSessionHistory] = createSignal({ id: "", points: [] })
    const tick = setInterval(() => setNow(Date.now()), 15000)

    let updateOverlay = null
    let updateOverlayTimer = null
    let updateOverlayDone = 0

    const ensureUpdateOverlay = () => {
      if (typeof document === "undefined" || !document.body) return null
      if (updateOverlay && document.body.contains(updateOverlay)) return updateOverlay

      const overlay = document.createElement("div")
      overlay.style.cssText = [
        "position: fixed",
        "right: 18px",
        "bottom: 18px",
        "z-index: 2147483646",
        "width: 340px",
        "max-width: calc(100vw - 36px)",
        "padding: 14px 16px",
        "border-radius: 12px",
        "border: 1px solid #334155",
        "background: rgba(15, 23, 42, 0.97)",
        "color: #e5e7eb",
        "box-shadow: 0 18px 50px rgba(0,0,0,.45)",
        "font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif",
        "pointer-events: auto",
        "display: none",
      ].join(";")

      const title = document.createElement("div")
      title.textContent = "Обновление плагина"
      title.style.cssText = "font-weight: 650; font-size: 14px; margin-bottom: 4px;"

      const versions = document.createElement("div")
      versions.style.cssText = "color: #93c5fd; margin-bottom: 8px;"

      const notes = document.createElement("div")
      notes.style.cssText =
        "color: #94a3b8; white-space: pre-line; max-height: 120px; overflow: auto; margin-bottom: 8px;"

      const size = document.createElement("div")
      size.style.cssText = "color: #94a3b8; font-size: 12px; margin-bottom: 8px;"

      const barOuter = document.createElement("div")
      barOuter.style.cssText =
        "height: 6px; border-radius: 999px; background: #334155; overflow: hidden;"

      const barInner = document.createElement("div")
      barInner.style.cssText =
        "height: 100%; width: 0%; background: #60a5fa; transition: width .25s ease;"
      barOuter.appendChild(barInner)

      const message = document.createElement("div")
      message.style.cssText = "margin-top: 8px; color: #cbd5e1; font-size: 12px;"

      const actions = document.createElement("div")
      actions.style.cssText =
        "display: none; gap: 8px; margin-top: 12px; justify-content: flex-end;"

      const later = document.createElement("button")
      later.type = "button"
      later.textContent = "Позже"
      later.style.cssText =
        "border: 1px solid #475569; border-radius: 8px; padding: 6px 12px; background: transparent; color: #e5e7eb; font: inherit; cursor: pointer;"
      later.addEventListener("click", () => {
        setUpdateDismissed(true)
        overlay.style.display = "none"
      })

      const install = document.createElement("button")
      install.type = "button"
      install.textContent = "Установить"
      install.style.cssText =
        "border: 0; border-radius: 8px; padding: 6px 12px; background: #3b82f6; color: #fff; font: inherit; font-weight: 600; cursor: pointer;"
      install.addEventListener("click", () => {
        setUpdateDismissed(true)
        overlay.style.display = "none"
        downloadOrInstallUpdate(windowUpdate())
      })

      actions.appendChild(later)
      actions.appendChild(install)

      overlay.appendChild(title)
      overlay.appendChild(versions)
      overlay.appendChild(notes)
      overlay.appendChild(size)
      overlay.appendChild(barOuter)
      overlay.appendChild(message)
      overlay.appendChild(actions)
      document.body.appendChild(overlay)

      updateOverlay = overlay
      overlay._refs = {
        title,
        versions,
        notes,
        size,
        barOuter,
        barInner,
        message,
        actions,
        install,
        later,
      }
      return overlay
    }

    const renderUpdateOverlay = () => {
      if (typeof document === "undefined") return
      const state = client.state()
      const update = windowUpdate()
      const overlay = ensureUpdateOverlay()
      if (!overlay) return

      const refs = overlay._refs
      const show = () => {
        overlay.style.display = "block"
      }
      const hide = () => {
        overlay.style.display = "none"
      }
      const setBar = (width) => {
        if (width === null) {
          refs.barOuter.style.display = "none"
          refs.barInner.style.width = "0%"
        } else {
          refs.barOuter.style.display = "block"
          refs.barInner.style.width = `${Math.max(0, Math.min(100, width))}%`
        }
      }
      const setActions = (visible) => {
        refs.actions.style.display = visible ? "flex" : "none"
      }

      if (state && state.updating) {
        show()
        setActions(false)
        setBar(Number(state.updateProgress) || 0)
        refs.title.textContent = "Обновление плагина"
        refs.versions.textContent = `${state.updateFrom || state.version} → ${state.updateTo || state.latestVersion}`
        refs.notes.textContent = state.updateNotes || ""
        refs.size.textContent = ""
        refs.message.textContent = `${state.updateMessage || "идёт обновление"}${state.updateProgress ? ` · ${Math.round(state.updateProgress)}%` : ""}`
        return
      }

      if (update.state === "checking") {
        show()
        setActions(false)
        setBar(30)
        refs.title.textContent = "Проверка обновлений"
        refs.versions.textContent = `Версия ${PLUGIN_VERSION}`
        refs.notes.textContent = ""
        refs.size.textContent = ""
        refs.message.textContent = "Проверяем обновления..."
        return
      }

      if (update.available && !updateDismissed()) {
        show()
        setActions(true)
        setBar(null)
        refs.title.textContent = "Доступно обновление"
        refs.versions.textContent = `${PLUGIN_VERSION} → ${update.latest}`
        refs.notes.textContent = update.notes || ""
        refs.size.textContent = `Вес обновления: ${formatSize(update.size)}`
        refs.message.textContent = "Установить обновление сейчас?"
        return
      }

      if (update.checkedAt && !update.available && !updateDismissed()) {
        const age = Date.now() - new Date(update.checkedAt).getTime()
        if (age < 6000) {
          show()
          setActions(false)
          setBar(null)
          refs.title.textContent = "Обновления"
          refs.versions.textContent = `Версия ${PLUGIN_VERSION}`
          refs.notes.textContent = ""
          refs.size.textContent = ""
          refs.message.textContent = "У вас последняя версия"
          return
        }
      }

      hide()
    }

    updateOverlayTimer = setInterval(renderUpdateOverlay, 500)
    renderUpdateOverlay()

    const checkForUpdatesWindow = async () => {
      setUpdateDismissed(false)
      setWindowUpdate((prev) => ({ ...prev, state: "checking", error: "" }))

      try {
        const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, {
          cache: "no-store",
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data = await response.json()
        const latest = String(data.version || "").trim()
        if (!latest) throw new Error("в манифесте нет версии")

        let size = Number(data.size) || 0
        if (!size && data.zip) {
          try {
            const zipResponse = await fetch(String(data.zip), { cache: "no-store" })
            const zipBuffer = await zipResponse.arrayBuffer()
            size = zipBuffer.byteLength
          } catch {}
        }

        setWindowUpdate({
          state: "done",
          latest,
          available: compareVersions(latest, PLUGIN_VERSION) > 0,
          notes: String(data.notes || ""),
          url: String(data.zip || ""),
          sha256: String(data.sha256 || ""),
          size,
          checkedAt: new Date().toISOString(),
          error: "",
        })
      } catch (error) {
        setWindowUpdate((prev) => ({
          ...prev,
          state: "error",
          checkedAt: new Date().toISOString(),
          error: String(error && error.message ? error.message : error),
        }))
      }
    }

    const downloadOrInstallUpdate = (update) => {
      if (!update || !update.url) return

      try {
        if (typeof client.installUpdate === "function") {
          void client
            .installUpdate({
              url: update.url,
              sha256: update.sha256,
              version: update.latest,
            })
            .catch(() => openExternalUrl(ctx, update.url))
          return
        }
      } catch {}

      openExternalUrl(ctx, update.url)
    }

    const toggleAutoUpdateWindow = () => {
      const next = !autoUpdateWindow()
      setAutoUpdateWindow(next)

      try {
        if (typeof client.toggleAutoUpdate === "function") {
          void client.toggleAutoUpdate().catch(() => {})
        }
      } catch {}
    }

    const loadSessionHistory = async (session) => {
      if (!session) return

      try {
        const byDay = new Map()
        let cursor = ""
        let guard = 0

        do {
          const query = { sessionID: session.id, limit: "500", type: "assistant" }
          if (cursor) query.cursor = cursor
          else query.order = "asc"

          const response = await client.session.message.list(query)
          const data = Array.isArray(response?.data)
            ? response.data
            : Array.isArray(response)
              ? response
              : []

          for (const message of data) {
            const info = message && message.info ? message.info : message
            if (!info || info.type !== "assistant") continue

            const cost = Number(info.cost)
            const created = info.time && info.time.created
            if (!Number.isFinite(cost) || cost <= 0 || !created) continue

            const key = localDateKey(new Date(created))
            byDay.set(key, (byDay.get(key) || 0) + cost)
          }

          cursor = response?.cursor?.next ?? ""
          guard++
        } while (cursor && guard < 20)

        setSessionHistory({
          id: session.id,
          points: [...byDay.entries()]
            .map(([date, usd]) => ({ date, usd }))
            .sort((left, right) => left.date.localeCompare(right.date)),
        })
      } catch {
        setSessionHistory({ id: session.id, points: [] })
      }
    }

    createEffect(() => {
      const session = ctx.sessions.current()
      if (session) void loadSessionHistory(session)
    })

    const historyTimer = setInterval(() => {
      const session = ctx.sessions.current()
      if (session) void loadSessionHistory(session)
    }, 60000)

    const windowUpdateTimer = setInterval(() => void checkForUpdatesWindow(), UPDATE_CHECK_INTERVAL)
    setTimeout(() => void checkForUpdatesWindow(), 2000)

    const decorateCurrencyButton = () => {
      if (typeof document === "undefined") return

      const pills = document.querySelectorAll('button[data-slot="session-plugin-pill"]')
      for (const pill of pills) {
        const label = Array.from(pill.querySelectorAll("span")).find((element) =>
          (element.textContent || "").trim().startsWith("DS "),
        )
        if (!label) continue

        let button = pill.querySelector('[data-currency-toggle="1"]')
        if (!button) {
          button = document.createElement("span")
          button.dataset.currencyToggle = "1"
          button.setAttribute("role", "button")
          button.setAttribute("tabindex", "0")
          button.title = "Переключить валюту"
          button.style.cssText = [
            "display:inline-flex",
            "align-items:center",
            "justify-content:center",
            "width:20px",
            "height:20px",
            "margin-right:6px",
            "border-radius:999px",
            "border:1px solid #64748b",
            "font-size:11px",
            "line-height:1",
            "font-weight:600",
            "cursor:pointer",
            "user-select:none",
            "flex:0 0 auto",
          ].join(";")

          const cycle = () => {
            const order = ["RUB", "CNY", "USD"]
            const current = displayCurrency()
            const next = order[(order.indexOf(current) + 1) % order.length]
            setDisplayCurrency(next)
            button.textContent = currencySymbol(next)
          }

          button.addEventListener("click", (event) => {
            event.preventDefault()
            event.stopPropagation()
            cycle()
          })
          button.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              event.stopPropagation()
              cycle()
            }
          })
        }

        const parent = label.parentNode
        if (parent && (button.parentNode !== parent || button.nextSibling !== label)) {
          parent.insertBefore(button, label)
        }

        button.textContent = currencySymbol(displayCurrency())
      }
    }

    const chartFullText = () => {
      const dataset = chartCache.get("session")
      if (!dataset || !dataset.points || dataset.points.length === 0) return ""

      return dataset.points
        .map(
          (point) =>
            `${formatShortDate(point.date)}: ${formatPrice(point.rate, dataset.digits)} ${dataset.unit}`,
        )
        .join(" · ")
    }

    const onChartRowMove = (event) => {
      if (!(event.target instanceof Element)) return
      const row = event.target.closest('[data-slot="session-plugin-pill-row"]')
      if (!row) return
      if (!(row.textContent || "").includes("расход по дням")) return

      const dataset = chartCache.get("session")
      if (!dataset || !dataset.points || dataset.points.length === 0) return

      const label = Array.from(row.querySelectorAll("span")).find(
        (element) =>
          !(element.textContent || "").includes("расход по дням") &&
          (element.textContent || "").trim().length > 0,
      )
      const rect = (label || row).getBoundingClientRect()
      const count = dataset.points.length
      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
      const index = Math.max(0, Math.min(count - 1, Math.floor(ratio * count)))
      const point = dataset.points[index]

      if (!point) {
        const text = chartFullText()
        if (text) showChartTooltip(text, event.clientX, event.clientY)
        return
      }

      const pointLabel = point.total ? "Итого" : formatShortDate(point.date)
      const text = `${pointLabel}: ${formatPrice(point.rate, dataset.digits)} ${dataset.unit}`
      showChartTooltip(text, event.clientX, event.clientY)
    }

    const onChartRowOut = (event) => {
      if (!(event.target instanceof Element)) return
      const row = event.target.closest('[data-slot="session-plugin-pill-row"]')
      if (!row) return
      if (!(row.textContent || "").includes("расход по дням")) return
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return
      hideChartTooltip()
    }

    if (typeof document !== "undefined") {
      document.addEventListener("mousemove", onChartRowMove)
      document.addEventListener("mouseout", onChartRowOut)
    }

    const currencyTimer = setInterval(decorateCurrencyButton, 750)
    decorateCurrencyButton()

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

      const fullText = points
        .map((point) => chartPointTitle(point, dataset.digits, dataset.showTime, dataset.unit))
        .join(" · ")

      row.setAttribute("title", fullText)

      if (!row.dataset.chartHover) {
        row.addEventListener("mouseenter", (event) =>
          showChartTooltip(fullText, event.clientX, event.clientY),
        )
        row.addEventListener("mousemove", (event) =>
          positionChartTooltip(event.clientX, event.clientY),
        )
        row.addEventListener("mouseleave", hideChartTooltip)
        row.dataset.chartHover = "1"
      }

      let label = Array.from(row.querySelectorAll("*")).find(
        (element) => element.children.length === 0 && (element.textContent || "").trim() === expected,
      )

      if (!label && typeof document.createTreeWalker === "function") {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        let node

        while ((node = walker.nextNode())) {
          const text = node.nodeValue || ""
          if (text.trim() !== expected && !text.includes(expected)) continue

          const container = document.createElement("span")
          container.style.display = "inline-block"
          const parent = node.parentNode
          if (!parent) continue

          if (text.trim() === expected) {
            parent.replaceChild(container, node)
          } else {
            const parts = text.split(expected)
            parent.insertBefore(document.createTextNode(parts[0]), node)
            parent.insertBefore(container, node)
            parent.insertBefore(document.createTextNode(parts.slice(1).join(expected)), node)
            parent.removeChild(node)
          }

          label = container
          break
        }
      }

      if (!label && datasetKey === "session") {
        const first = row.firstElementChild
        if (first && (first.textContent || "").trim() === expected) label = first
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
          const storeDaily = sessionDailySpend(input.session)
          const history = sessionHistory()
          const merged = new Map()

          if (history.id === input.session.id) {
            for (const point of history.points) {
              merged.set(point.date, Math.max(merged.get(point.date) || 0, point.usd))
            }
          }
          for (const point of storeDaily) {
            merged.set(point.date, Math.max(merged.get(point.date) || 0, point.usd))
          }

          const dailyPoints = [...merged.entries()]
            .filter(([, value]) => value > 0)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([date, value]) => ({ date, usd: value }))

          const todayUsd = sessionSpendToday(dailyPoints)
          const totalUsd =
            typeof usd === "number"
              ? usd
              : dailyPoints.reduce((sum, point) => sum + point.usd, 0)

          const chartPoints = dailyPoints
            .slice(-9)
            .map((point) => ({ date: point.date, usd: point.usd, total: false }))
          if (totalUsd > 0) {
            chartPoints.push({
              date: localDateKey(new Date()),
              usd: totalUsd,
              total: true,
            })
          }

          const canRub = state.cbr > 0 && state.rate > 0
          const requested = displayCurrency()
          const currency =
            requested === "RUB" && !canRub
              ? "CNY"
              : requested === "USD"
                ? "USD"
                : requested === "RUB"
                  ? "RUB"
                  : "CNY"
          const rate = currency === "RUB" ? state.cbr : currency === "USD" ? 1 : state.rate
          const cnyToRub = canRub ? state.cbr / state.rate : 0
          const cnyToUsd = state.rate > 0 ? 1 / state.rate : 0

          const balances = parseBalances(state.detail)
          const cnyBalance = Number(
            (balances.find((balance) => balance.currency === "CNY") || {}).total || 0,
          )
          const balanceValue =
            currency === "RUB"
              ? cnyBalance * cnyToRub
              : currency === "USD"
                ? cnyBalance * cnyToUsd
                : cnyBalance
          const balanceLabel =
            cnyBalance > 0 ? `DS ${formatMoneyShort(balanceValue, currency)}` : state.label

          const spend = state.rate > 0 && usd !== null ? `−${formatMoney(usd * rate, currency)}` : null
          const today = state.rate > 0 && usd !== null ? `−${formatMoney(todayUsd * rate, currency)}` : null
          const spendShort =
            state.rate > 0 && usd !== null ? `−${formatMoneyShort(usd * rate, currency)}` : null
          const todayShort =
            state.rate > 0 && usd !== null ? `−${formatMoneyShort(todayUsd * rate, currency)}` : null
          const label = [balanceLabel, spendShort, todayShort].filter(Boolean).join(" · ")
          const chartUnit = currencySymbol(currency)

          if (state.rate > 0 && chartPoints.length > 0) {
            setChartPoints(
              "session",
              JSON.stringify(
                chartPoints.map((point) => ({
                  date: point.date,
                  rate: point.usd * rate,
                  ts: 0,
                  total: !!point.total,
                })),
              ),
              2,
              false,
              chartUnit,
              false,
            )
          } else {
            setChartPoints("session", "[]", 2, false, chartUnit, false)
          }

          const rows = buildRows(
            { ...state, refresh: () => client.refresh() },
            usd,
            chartPoints,
            todayUsd,
            { currency, setCurrency: setDisplayCurrency },
          )

          const update = windowUpdate()

          rows.unshift({
            id: "version",
            label: `Версия плагина: ${PLUGIN_VERSION}`,
            detail: state.updating
              ? "идёт обновление"
              : update.state === "checking"
                ? "проверяем обновление…"
                : update.error
                  ? "проверка не удалась"
                  : update.available
                    ? `доступна ${update.latest}`
                    : update.checkedAt
                      ? "последняя версия"
                      : "нажмите «Проверить обновление»",
          })

          if (state.updating) {
            rows.push({
              id: "update-progress",
              label: `Обновление ${state.updateFrom} → ${state.updateTo}`,
              detail: `${state.updateMessage || "идёт обновление"} · ${Math.round(state.updateProgress)}%`,
            })
          } else if (update.available) {
            rows.push({
              id: "update-available",
              label: `Обновить до ${update.latest}`,
              detail: update.notes
                ? update.notes.split("\n")[0].slice(0, 120)
                : "скачать и установить",
              run: () => downloadOrInstallUpdate(update),
            })
          }

          rows.push({
            id: "auto-update",
            label: `Автообновление: ${autoUpdateWindow() ? "вкл" : "выкл"}`,
            detail: autoUpdateWindow() ? "новые версии ставятся сами" : "только по кнопке",
            run: () => toggleAutoUpdateWindow(),
          })

          rows.push({
            id: "check-update",
            label: update.state === "checking" ? "Проверяем обновление…" : "Проверить обновление",
            detail: update.error
              ? `ошибка: ${update.error}`
              : update.checkedAt && !update.available
                ? "у вас последняя версия"
                : "",
            run: () => void checkForUpdatesWindow(),
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
      if (updateOverlayTimer) clearInterval(updateOverlayTimer)
      if (updateOverlay && updateOverlay.parentNode) updateOverlay.parentNode.removeChild(updateOverlay)
      updateOverlay = null
      if (currencyTimer) clearInterval(currencyTimer)
      if (windowUpdateTimer) clearInterval(windowUpdateTimer)
      if (historyTimer) clearInterval(historyTimer)
      if (typeof document !== "undefined") {
        document.removeEventListener("mousemove", onChartRowMove)
        document.removeEventListener("mouseout", onChartRowOut)
      }
    }
  },

  main(ctx) {
    const { execFile } = require("node:child_process")
    const crypto = require("node:crypto")
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
      updateSha: "",
      updating: false,
      updateProgress: 0,
      updateMessage: "",
      updateFrom: PLUGIN_VERSION,
      updateTo: "",
      autoUpdate: true,
    }
    let provider
    let balanceTimer
    let rateTimer
    let cbrTimer
    let updateTimer
    let autoUpdateTimer

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

    function runPowerShell(args, timeout) {
      return new Promise((resolve) => {
        execFile(
          "powershell.exe",
          ["-NoProfile", "-ExecutionPolicy", "Bypass"].concat(args),
          { timeout: timeout || 120000, windowsHide: true },
          (error, stdout, stderr) => resolve({ error, stdout, stderr }),
        )
      })
    }

    function findFile(dir, name) {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            const found = findFile(full, name)
            if (found) return found
          } else if (entry.name.toLowerCase() === name.toLowerCase()) {
            return full
          }
        }
      } catch {}

      return null
    }

    function findCli() {
      const local = path.join(
        process.env.LOCALAPPDATA || "",
        "Programs",
        "ai.opencode.desktop",
        "resources",
        "opencode-cli.exe",
      )
      if (fs.existsSync(local)) return local
      return "opencode-cli.exe"
    }

    function setUpdate(progress, message) {
      snapshot = {
        ...snapshot,
        updating: true,
        updateProgress: progress,
        updateMessage: message,
      }
      provider.changed()
      saveDebug()
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
          updateSha: String(data.sha256 || "").trim(),
          updateFrom: PLUGIN_VERSION,
          updateTo: latest,
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

      if (snapshot.updateAvailable && snapshot.autoUpdate && !snapshot.updating) {
        if (autoUpdateTimer) clearTimeout(autoUpdateTimer)
        autoUpdateTimer = setTimeout(() => void installUpdate(), 5000)
      }
    }

    async function installUpdate() {
      if (snapshot.updating) return
      if (!snapshot.updateUrl) {
        snapshot = { ...snapshot, updateError: "Нет ссылки на обновление" }
        provider.changed()
        return
      }

      const from = PLUGIN_VERSION
      const to = snapshot.latestVersion || "?"
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)
      const configDir = path.join(process.env.USERPROFILE || "", ".config", "opencode")
      const pluginDir = path.join(configDir, "deepseek-balance-plugin")
      const tempZip = path.join(os.tmpdir(), `opencode-pills-${stamp}.zip`)
      const tempDir = path.join(os.tmpdir(), `opencode-pills-${stamp}`)
      let oldPlugin = null
      let installed = false

      try {
        setUpdate(3, `Скачивание ${to}...`)

        const response = await fetch(snapshot.updateUrl, {
          signal: AbortSignal.timeout(120000),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const buffer = Buffer.from(await response.arrayBuffer())
        const hash = crypto.createHash("sha256").update(buffer).digest("hex")
        if (snapshot.updateSha && hash.toLowerCase() !== snapshot.updateSha.toLowerCase()) {
          throw new Error("sha256 не совпал")
        }
        fs.writeFileSync(tempZip, buffer)

        setUpdate(25, "Распаковка...")
        fs.mkdirSync(tempDir, { recursive: true })
        const expand = await runPowerShell([
          "-Command",
          `Expand-Archive -LiteralPath '${tempZip}' -DestinationPath '${tempDir}' -Force`,
        ])
        if (expand.error) throw new Error(String(expand.stderr || expand.error.message).trim())

        const installer = findFile(tempDir, "install.ps1")
        if (!installer) throw new Error("в архиве нет install.ps1")

        setUpdate(40, "Бэкап конфига...")
        const backupDir = `${configDir}.backup-${stamp}`
        try {
          fs.cpSync(configDir, backupDir, { recursive: true })
        } catch {
          await runPowerShell([
            "-Command",
            `Copy-Item -Recurse -Force -LiteralPath '${configDir}' -Destination '${backupDir}'`,
          ])
        }

        setUpdate(55, "Выгрузка текущей версии...")
        if (fs.existsSync(pluginDir)) {
          oldPlugin = `${pluginDir}.old-${stamp}`
          fs.renameSync(pluginDir, oldPlugin)
        }

        setUpdate(65, `Установка ${to}...`)
        const install = await runPowerShell([
          "-File",
          installer,
          "-SkipSessionImport",
          "-ReplaceHistory",
        ], 180000)
        if (install.error) throw new Error(String(install.stderr || install.error.message).trim())
        installed = true

        setUpdate(85, "Перезагрузка OpenCode...")
        const cli = findCli()
        if (cli) {
          await runPowerShell(["-Command", `& '${cli}' reload`], 60000)
        }

        snapshot = {
          ...snapshot,
          updating: false,
          updateProgress: 100,
          updateMessage: "Готово. Нажмите Ctrl+R",
          updateAvailable: false,
          updateError: "",
          version: to,
          latestVersion: to,
          updateFrom: from,
          updateTo: to,
        }
      } catch (error) {
        const message = String(error && error.message ? error.message : error).trim()

        if (!installed && oldPlugin && fs.existsSync(oldPlugin)) {
          try {
            if (fs.existsSync(pluginDir)) {
              fs.renameSync(pluginDir, `${pluginDir}.failed-${stamp}`)
            }
            fs.renameSync(oldPlugin, pluginDir)
          } catch {}
        }

        snapshot = {
          ...snapshot,
          updating: false,
          updateProgress: 0,
          updateMessage: "Ошибка обновления",
          updateError: message,
        }
      }

      provider.changed()
      saveDebug()
    }

    function toggleAutoUpdate() {
      snapshot = { ...snapshot, autoUpdate: !snapshot.autoUpdate }
      if (autoUpdateTimer) {
        clearTimeout(autoUpdateTimer)
        autoUpdateTimer = null
      }
      if (snapshot.autoUpdate && snapshot.updateAvailable && !snapshot.updating) {
        autoUpdateTimer = setTimeout(() => void installUpdate(), 1000)
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
      installUpdate(input) {
        if (input) {
          snapshot = {
            ...snapshot,
            updateUrl: input.url || snapshot.updateUrl,
            updateSha: input.sha256 || snapshot.updateSha,
            latestVersion: input.version || snapshot.latestVersion,
            updateTo: input.version || snapshot.updateTo,
            updateFrom: PLUGIN_VERSION,
          }
        }

        return installUpdate()
      },
      toggleAutoUpdate() {
        return toggleAutoUpdate()
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
      if (autoUpdateTimer) clearTimeout(autoUpdateTimer)
    }
  },
})

module.exports = definition
module.exports.default = definition
