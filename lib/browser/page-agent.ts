import {
  computeAccessibleName,
  getRole,
  isInaccessible
} from "dom-accessibility-api"
import Papa from "papaparse"

// Bundled locally and injected in Chrome's ISOLATED world. Page text is data:
// no eval, script execution, remote code, or page-owned tool definitions.
type Target = { selector?: string; role?: string; name?: string }
const clean = (value: string | null | undefined, max = 30000) =>
  (value || "").replace(/\s+/g, " ").trim().slice(0, max)
function elements(root: Document | ShadowRoot | Element = document): Element[] {
  const found: Element[] = []
  const visit = (root: Document | ShadowRoot | Element, depth: number) => {
    if (depth > 20) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let node: Node | null
    while (found.length < 10000 && (node = walker.nextNode())) {
      const el = node as Element
      found.push(el)
      if (el.shadowRoot) visit(el.shadowRoot, depth + 1)
    }
  }
  visit(root, 0)
  return found
}
function visible(el: Element) {
  const rect = el.getBoundingClientRect()
  return (
    !isInaccessible(el) &&
    !el.closest("[hidden],[inert]") &&
    rect.width > 0 &&
    rect.height > 0
  )
}
function enabled(el: Element) {
  return (
    !el.matches(':disabled,[aria-disabled="true"]') && !el.closest("[inert]")
  )
}
function matches(el: Element, target: Target) {
  return (
    (!target.selector || el.matches(target.selector)) &&
    (!target.role || getRole(el) === target.role) &&
    (target.name === undefined ||
      clean(computeAccessibleName(el)).toLowerCase() ===
        clean(target.name).toLowerCase())
  )
}
function targets(target: Target, root?: Element) {
  return elements(root).filter((el) => matches(el, target) && visible(el))
}
function one(target: Target, root?: Element): HTMLElement {
  const all = targets(target, root)
  if (all.length !== 1)
    throw new Error(
      all.length
        ? `Ambiguous target: ${all.length} visible matches. Use a unique selector or accessible name.`
        : "Target not found or not visible"
    )
  return all[0] as HTMLElement
}
function details(el: Element) {
  return {
    tag: el.tagName.toLowerCase(),
    role: getRole(el),
    name: clean(computeAccessibleName(el), 1000),
    text: clean(el.textContent, 2000),
    enabled: enabled(el),
    checked:
      (el as HTMLInputElement).checked ?? el.getAttribute("aria-checked"),
    href: el instanceof HTMLAnchorElement ? safeLink(el.href) : undefined
  }
}
function safeLink(value: string) {
  try {
    const url = new URL(value, location.href)
    return ["https:", "http:"].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
function pageText(root: Element) {
  // Read text nodes only: no field values, hidden controls, scripts or styles.
  const parts: string[] = []
  let length = 0,
    visited = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode()) && length < 30000 && ++visited <= 20000) {
    const parent = node.parentElement
    if (
      !parent ||
      parent.closest(
        'script,style,noscript,textarea,input,[contenteditable="true"]'
      ) ||
      !visible(parent)
    )
      continue
    const value = clean(node.textContent, 30000 - length)
    parts.push(value)
    length += value.length
  }
  return parts.join(" ").slice(0, 30000)
}
function click(el: HTMLElement) {
  if (!enabled(el)) throw new Error("Target is disabled")
  el.scrollIntoView({ block: "center" })
  el.click()
  return {
    dispatched: true,
    target: details(el),
    note: "Click dispatched. Verify the resulting page state before claiming the task completed."
  }
}
function writable(el: HTMLElement) {
  if (!enabled(el) || el.matches('[readonly],[aria-readonly="true"]'))
    throw new Error("Field is disabled or read-only")
  if (
    el instanceof HTMLInputElement &&
    ["password", "file", "hidden", "submit", "button"].includes(el.type)
  )
    throw new Error("This field requires direct user interaction")
  if (
    !(
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      el.isContentEditable ||
      el.getAttribute("contenteditable") === "true"
    )
  )
    throw new Error("Unsupported field; inspect its accessible controls")
}
function setValue(el: HTMLElement, value: string) {
  writable(el)
  if (
    el instanceof HTMLSelectElement &&
    ![...el.options].some((o) => o.value === value && !o.disabled)
  )
    throw new Error("Requested option is unavailable")
  if (
    el instanceof HTMLInputElement &&
    ["checkbox", "radio", "range"].includes(el.type)
  )
    throw new Error("Use the dedicated checkbox, radio or range tool")
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    const prototype =
      el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLSelectElement.prototype
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value)
  } else el.textContent = value
  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: value
    })
  )
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
  const actual = "value" in el ? (el as HTMLInputElement).value : el.textContent
  if (actual !== value)
    throw new Error("The page did not retain the requested value")
}
function readChecked(el: Element) {
  return el instanceof HTMLInputElement
    ? el.checked
    : el.getAttribute("aria-checked") === "true"
}
function skipButtons() {
  const all = elements().filter(
    (el) =>
      visible(el) &&
      enabled(el) &&
      (el.matches(
        ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, [class*='ytp-ad-skip-button'], [class*='ytp-skip-ad-button'], .videoAdUiSkipButton, button[id^='skip-button']"
      ) ||
        el.closest(".ytp-ad-skip-button-container, .ytp-ad-skip-button-slot") !== null ||
        (getRole(el) === "button" &&
          /^(?:skip(?:\s+(?:all\s+)?ads?|\s+advertisements?|\s+intro)?|saltar\s+anuncio|passer\s+l'annonce|ignorer\s+l'annonce|werbung\s+überspringen|salta\s+annuncio|pular\s+anúncio|пропустить\s+рекламу|広告をスキップ|跳过广告|تخطي\s+الإعلان|विज्ञापन\s+छोड़ें)(?:\s*[\s\d>›»•|.-]*)?$/i.test(
            clean(computeAccessibleName(el))
          )))
  ) as HTMLElement[]

  if (all.length <= 1) return all

  // Deduplicate nested elements: prefer actual buttons over wrapper spans/divs
  const buttonsOnly = all.filter((el) => el.tagName === "BUTTON" || getRole(el) === "button")
  const candidates = buttonsOnly.length > 0 ? buttonsOnly : all

  const unnested = candidates.filter(
    (el) => !candidates.some((other) => other !== el && el.contains(other))
  )

  if (unnested.length <= 1) return unnested

  // Prefer skip buttons inside active media player (#movie_player, .html5-video-player)
  const inPlayer = unnested.filter((el) => el.closest("#movie_player, .html5-video-player, [class*='video-player']"))
  if (inPlayer.length === 1) return inPlayer

  return unnested
}

export async function pageAction(action: string, p: any): Promise<any> {
  const source = { url: location.href, title: document.title }
  switch (action) {
    case "probe": {
      const found = targets(p.target)
      return {
        count: found.length,
        enabled: found.length === 1 && enabled(found[0]),
        text: found.length === 1 ? clean(found[0].textContent) : ""
      }
    }
    case "skipProbe":
      return { count: skipButtons().length }
    case "clickSkipButton": {
      const buttons = skipButtons()
      if (buttons.length !== 1) {
        if (buttons.length > 1) {
          const firstInPlayer = buttons.find((el) => el.closest("#movie_player, .html5-video-player")) || buttons[0]
          return click(firstInPlayer)
        }
        throw new Error("No enabled skip control is available")
      }
      return click(buttons[0])
    }
    case "clickByRole":
    case "clickWhenReady":
      return click(one(p.target))
    case "hoverElement": {
      const el = one(p.target)
      el.scrollIntoView({ block: "center" })
      el.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, composed: true })
      )
      el.dispatchEvent(new MouseEvent("mouseenter", { composed: true }))
      return {
        dispatched: true,
        note: "Hover events dispatched; inspect the resulting controls."
      }
    }
    case "scrollToElement": {
      const el = one(p.target)
      el.scrollIntoView({ block: p.align })
      return details(el)
    }
    case "scrollContainer": {
      const el = one(p.target)
      const before = { x: el.scrollLeft, y: el.scrollTop }
      el.scrollBy({
        left: p.x,
        top: p.y,
        behavior: "instant" as ScrollBehavior
      })
      return { before, after: { x: el.scrollLeft, y: el.scrollTop } }
    }
    case "setCheckbox":
    case "selectRadioOption": {
      const el = one(p.target),
        role = getRole(el),
        desired = action === "selectRadioOption" || p.checked
      if (
        !(action === "setCheckbox"
          ? ["checkbox", "switch"].includes(role || "")
          : role === "radio")
      )
        throw new Error("Target has the wrong control role")
      if (!enabled(el)) throw new Error("Control is disabled")
      if (readChecked(el) !== desired) click(el)
      if (readChecked(el) !== desired)
        throw new Error(
          "Control did not report the requested checked state; inspect it before retrying"
        )
      return { checked: readChecked(el), target: details(el) }
    }
    case "fillFormFields":
    case "clearFormFields": {
      const fields: { target: Target; value: string }[] =
        action === "clearFormFields"
          ? p.targets.map((target: Target) => ({ target, value: "" }))
          : p.fields
      const resolved = fields.map((f) => ({
        el: one(f.target),
        value: f.value
      }))
      resolved.forEach((f) => writable(f.el))
      if (new Set(resolved.map((f) => f.el)).size !== resolved.length)
        throw new Error("Two fields resolve to the same control")
      const filled: number[] = []
      try {
        for (let i = 0; i < resolved.length; i++) {
          setValue(resolved[i].el, resolved[i].value)
          filled.push(i)
        }
      } catch (error) {
        throw new Error(
          `Filled field indexes ${filled.join(", ")}; stopped: ${String(error)}`
        )
      }
      return { filled: filled.length, submitted: false }
    }
    case "replaceFieldText": {
      const el = one(p.target)
      const value =
        "value" in el ? (el as HTMLInputElement).value : el.textContent || ""
      if (!value.includes(p.find))
        throw new Error("Requested text is not present")
      setValue(el, value.replaceAll(p.find, p.replacement))
      return { replaced: true }
    }
    case "selectDate": {
      const el = one(p.target)
      if (!(el instanceof HTMLInputElement) || el.type !== "date")
        throw new Error(
          "Use the visible calendar controls for a custom date picker"
        )
      setValue(el, p.date)
      if (!el.validity.valid) throw new Error(el.validationMessage)
      return { date: el.value }
    }
    case "setRangeValue": {
      const el = one(p.target)
      if (
        !(el instanceof HTMLInputElement) ||
        el.type !== "range" ||
        !enabled(el)
      )
        throw new Error(
          "Choose an enabled native range input; use accessible controls for a custom slider"
        )
      const min = Number(el.min || 0),
        max = Number(el.max || 100),
        step = el.step === "any" ? 0 : Number(el.step || 1)
      if (
        p.value < min ||
        p.value > max ||
        (step &&
          Math.abs(
            (p.value - min) / step - Math.round((p.value - min) / step)
          ) > 1e-8)
      )
        throw new Error("Value is outside the permitted range or step")
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(el, String(p.value))
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      if (el.valueAsNumber !== p.value)
        throw new Error("Slider did not retain requested value")
      return { value: el.valueAsNumber }
    }
    case "inspectFormErrors":
      return {
        ...source,
        errors: elements()
          .filter(
            (el) =>
              visible(el) &&
              el.matches(
                'input:invalid,select:invalid,textarea:invalid,[aria-invalid="true"],[role="alert"]'
              )
          )
          .slice(0, 100)
          .map((el) => ({
            ...details(el),
            validationMessage: (el as HTMLInputElement).validationMessage || ""
          }))
      }
    case "readSelection":
      return { ...source, text: clean(getSelection()?.toString()) }
    case "readPageText":
      return {
        ...source,
        text: pageText(p.target ? one(p.target) : document.body),
        note: "Visible text, bounded to 30000 characters; inspect frames and shadow controls separately if needed."
      }
    case "readElementDetails":
      return { ...source, ...details(one(p.target)) }
    case "findTextOnPage": {
      const hits = elements()
        .filter(
          (el) =>
            visible(el) &&
            !el.matches("script,style,input,textarea") &&
            ![...el.children].some((c) =>
              clean(c.textContent).toLowerCase().includes(p.text.toLowerCase())
            ) &&
            clean(el.textContent).toLowerCase().includes(p.text.toLowerCase())
        )
        .slice(0, p.limit)
      return { ...source, matches: hits.map(details) }
    }
    case "extractTable": {
      const table = one(p.target)
      if (!(table instanceof HTMLTableElement))
        throw new Error("Target must be a native HTML table")
      const rows: string[][] = [],
        spans: Record<number, { value: string; remaining: number }> = {}
      for (const row of [...table.rows].slice(0, p.limit)) {
        const values: string[] = []
        for (const [key, span] of Object.entries(spans)) {
          values[Number(key)] = span.value
          if (--span.remaining === 0) delete spans[Number(key)]
        }
        let column = 0
        for (const cell of [...row.cells]) {
          while (values[column] !== undefined) column++
          const value = clean(cell.textContent, 2000),
            width = Math.min(cell.colSpan, 50 - column)
          for (let i = 0; i < width; i++) {
            values[column] = value
            if (cell.rowSpan > 1)
              spans[column] = {
                value,
                remaining: Math.min(cell.rowSpan - 1, 100)
              }
            column++
          }
          if (column >= 50) break
        }
        rows.push(
          Array.from({ length: values.length }, (_, i) => values[i] || "")
        )
      }
      return {
        ...source,
        rows,
        csv: Papa.unparse(rows, { escapeFormulae: true }),
        truncated: table.rows.length > p.limit
      }
    }
    case "collectSearchResults":
    case "collectLinks": {
      const links = elements().filter(
        (el) =>
          el instanceof HTMLAnchorElement &&
          visible(el) &&
          (!p.selector || el.matches(p.selector))
      ) as HTMLAnchorElement[]
      const seen = new Set<string>()
      const results = links
        .flatMap((a) => {
          const url = safeLink(a.href),
            title = clean(computeAccessibleName(a) || a.textContent, 1000)
          if (
            !url ||
            !title ||
            seen.has(url) ||
            (action === "collectSearchResults" &&
              !p.selector &&
              !a.querySelector("h2,h3") &&
              !a.closest("h2,h3"))
          )
            return []
          seen.add(url)
          return [{ url, title }]
        })
        .slice(0, p.limit)
      return {
        ...source,
        results,
        note:
          action === "collectSearchResults"
            ? "Heading links only by default. Supply an inspected selector for another result layout."
            : undefined
      }
    }
    case "extractStructuredData": {
      const values: unknown[] = [],
        errors: string[] = []
      for (const script of [
        ...document.querySelectorAll('script[type="application/ld+json"]')
      ].slice(0, 20)) {
        const value = script.textContent || ""
        if (value.length > 50000) {
          errors.push("Oversized JSON-LD skipped")
          continue
        }
        try {
          values.push(JSON.parse(value))
        } catch {
          errors.push("Invalid JSON-LD skipped")
        }
      }
      return { ...source, values, errors }
    }
    case "inspectDialog":
      return {
        ...source,
        dialogs: elements()
          .filter(
            (el) =>
              visible(el) &&
              el.matches('dialog[open],[role="dialog"],[role="alertdialog"]')
          )
          .slice(0, 10)
          .map((el) => ({
            ...details(el),
            controls: elements(el)
              .filter(
                (c) =>
                  visible(c) &&
                  ["button", "link", "checkbox"].includes(getRole(c) || "")
              )
              .slice(0, 30)
              .map(details)
          }))
      }
    case "chooseDialogAction": {
      const dialog = one(p.dialog)
      if (!dialog.matches('dialog[open],[role="dialog"],[role="alertdialog"]'))
        throw new Error("Choose a visible dialog")
      return click(one(p.target, dialog))
    }
    case "rejectOptionalCookies":
    case "dismissNotificationPrompt": {
      const pattern =
        action === "rejectOptionalCookies"
          ? /^(?:reject all|reject optional cookies|reject non-essential cookies|decline optional cookies|only necessary|necessary only)$/i
          : /^(?:not now|no thanks|block notifications|dismiss)$/i
      const dialogs = elements().filter(
        (el) =>
          visible(el) &&
          el.matches('dialog[open],[role="dialog"],[role="alertdialog"]') &&
          (action === "rejectOptionalCookies"
            ? /cookies/i
            : /notifications/i
          ).test(el.textContent || "")
      )
      const buttons = dialogs.flatMap((d) =>
        elements(d).filter(
          (el) =>
            visible(el) &&
            enabled(el) &&
            getRole(el) === "button" &&
            pattern.test(clean(computeAccessibleName(el)))
        )
      ) as HTMLElement[]
      if (buttons.length !== 1)
        throw new Error(
          "No unique supported dialog action. Inspect the dialog; native browser prompts require direct user interaction."
        )
      return click(buttons[0])
    }
    case "selectCaptions": {
      const media = one(p.target)
      if (!(media instanceof HTMLMediaElement))
        throw new Error("Choose a native media element")
      const tracks = [...media.textTracks].filter((t) =>
        ["captions", "subtitles"].includes(t.kind)
      )
      const matches = tracks.filter(
        (t) =>
          t.language.toLowerCase() === p.language.toLowerCase() ||
          t.label.toLowerCase() === p.language.toLowerCase()
      )
      if (p.language !== "off" && matches.length !== 1)
        throw new Error(
          `Choose an available caption track: ${JSON.stringify(tracks.map((t) => ({ language: t.language, label: t.label })))}`
        )
      tracks.forEach((t) => {
        t.mode =
          p.language !== "off" && t === matches[0] ? "showing" : "disabled"
      })
      return { language: p.language }
    }
    case "selectPlaybackQuality": {
      const select = one(p.target)
      if (!(select instanceof HTMLSelectElement))
        throw new Error(
          "Inspect the player quality menu and use clickByRole for custom controls"
        )
      setValue(select, p.value)
      return { selected: select.value }
    }
    case "extractAvailableTranscript": {
      if (p.target) return { ...source, text: pageText(one(p.target)) }
      const tracks = elements()
        .filter((el) => el instanceof HTMLMediaElement)
        .flatMap((el) => [...(el as HTMLMediaElement).textTracks])
        .filter((t) => ["captions", "subtitles"].includes(t.kind) && t.cues)
      const cues = tracks.flatMap((t) =>
        [...t.cues!].slice(0, 1000).map((cue) => ({
          start: cue.startTime,
          end: cue.endTime,
          text: clean((cue as VTTCue).text, 1000),
          language: t.language
        }))
      )
      if (!cues.length)
        throw new Error(
          "No loaded transcript is available. Open the site transcript or captions and try again."
        )
      return { ...source, cues: cues.slice(0, 1000) }
    }
    default:
      throw new Error("Unsupported page action")
  }
}

Object.defineProperty(globalThis, "__pentonePageAgent", {
  value: pageAction,
  configurable: true
})
