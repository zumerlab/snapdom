/**
 * Fillable forms: a captured control becomes a real AcroForm field.
 *
 * The reasoning is the plugin's own, extended one step. A capture of a form is a
 * PICTURE of a form; the invisible text layer already made the picture's values
 * selectable and searchable. But a form's meaning is not its pixels — it is that
 * someone can FILL it — and this exporter starts from the DOM, where the field
 * boundaries, names, values, options and states are facts, not inferences. No
 * competitor starting from a raster gets them at all; one starting from a layout
 * engine gets them without the person's typed values. We get both for free.
 *
 * The appearance rule is dictated by the one viewer that will not be argued
 * with. PDFKit — macOS Preview, Quick Look — draws a text field's /V ITSELF, on
 * top of the appearance stream, whenever that stream contains an image XObject
 * or shows no visible text (MEASURED against a probe matrix of appearance
 * variants; `Tr 3` does not count as visible, and a painted-then-covered value
 * does not either once any `Do` is present). So:
 *
 *  - **a field holding a value** gets a REAL text appearance — background,
 *    border, and the value drawn from the text layer's own measured runs, so a
 *    textarea's wrap and an input's alignment are the layout's, not a guess;
 *  - **an empty field** gets the control's own crop of the page raster —
 *    border, corner radius and placeholder pixel-exact — because with no /V
 *    there is nothing PDFKit wants to redraw over it;
 *  - the PAGE image stops painting every fielded control (see index.js), so no
 *    viewer ever shows a stale value under a live field.
 *
 * What deliberately does NOT happen here:
 *
 *  - **A password value never reaches the file.** The field exists, flagged as a
 *    password field, and starts empty. The text layer's bullet rule, restated.
 *  - **No JavaScript actions, no submit URLs.** A generated file that phones home
 *    is a liability, not a feature. Filling and saving is the scope.
 *  - **Buttons stay pixels.** A push button with no action is decoration, and
 *    inventing actions is exactly what this plugin never does.
 *
 * The capture half lives in the text layer's walk (`collectTextLayer`'s control
 * records), because field geometry must come from the same measurement pass and
 * the same visibility rules as everything else. This file plans fields from
 * those records and writes the AcroForm bytes.
 */
import { pdfTextString, pdfString } from '../writer/index.js'

/** Field flag bits, 1-based as the spec numbers them. */
const FF = {
  readOnly: 1 << 0,
  required: 1 << 1,
  multiline: 1 << 12,
  password: 1 << 13,
  noToggleToOff: 1 << 14,
  radio: 1 << 15,
  combo: 1 << 17,
  multiSelect: 1 << 21,
}

/** /Q — quadding. */
const ALIGN = { left: 0, center: 1, right: 2 }

const num = (n) => Number(n.toFixed(3))
const rgb = (c) => c.map(v => num(v)).join(' ')

/** What the control visibly SAYS — a select says its selected label, a password
 * says nothing anywhere. */
const displayValue = (c) => {
  if (c.kind === 'password') return ''
  if (c.kind === 'select') {
    return c.options.filter(o => o.selected).map(o => o.label || o.value).join(', ')
  }
  return String(c.value || '')
}

/**
 * Whether this field's appearance should be the control's raster crop. Only an
 * EMPTY text-ish field can afford one: PDFKit redraws /V over any appearance
 * carrying an image, so a valued field must use a text appearance, and a
 * password field must look empty rather than show the crop's bullets.
 * Exported so index.js encodes a crop only when one will be referenced.
 */
export function wantsCropAP(field, control) {
  if (field.kind === 'checkbox' || field.kind === 'radio' || field.kind === 'password') return false
  return displayValue(control) === ''
}

/**
 * Group control records into fields, radio groups included, and settle names.
 *
 * PDF field names are a hierarchy keyed by /T, and two unrelated fields sharing
 * one name become ONE field with one value — HTML's behaviour only for radios.
 * So radios group by name on purpose and everything else is uniquified with a
 * suffix, reported once.
 *
 * @param {Array<object>} controls  records from the text layer's control walk
 * @param {(msg: string) => void} report
 * @returns {{fields: Array<object>, suppressed: Set<number>, needAppearances: boolean}}
 *   `suppressed` holds text-layer run indices whose words now live in a field's
 *   value — leaving them in the invisible layer would double every extraction.
 */
export function planFields(controls, report) {
  const fields = []
  const suppressed = new Set()
  const radios = new Map()
  const used = new Map()
  let renamed = 0
  let skippedTransform = 0
  let skippedClipped = 0
  let passwords = 0
  let needAppearances = false

  const uniqueName = (wanted) => {
    const base = wanted || 'field'
    const n = used.get(base) || 0
    used.set(base, n + 1)
    if (n === 0) return base
    renamed++
    return `${base}.${n + 1}`
  }

  for (let i = 0; i < controls.length; i++) {
    const c = controls[i]
    if (c.skip === 'transformed') { skippedTransform++; continue }
    if (c.skip === 'clipped') { skippedClipped++; continue }

    if (c.kind === 'radio') {
      // One field per group; the group key is the HTML name, which is the
      // grouping HTML itself uses. A nameless radio is its own group.
      const key = c.name || `radio.${i}`
      if (!radios.has(key)) {
        const field = {
          kind: 'radio', name: null, wantedName: c.name || 'radio',
          label: c.label, members: [], flags: FF.radio | FF.noToggleToOff,
        }
        radios.set(key, field)
        fields.push(field)
      }
      const field = radios.get(key)
      field.members.push({ i, control: c })
      if (!field.label && c.label) field.label = c.label
      if (c.readonly) field.flags |= FF.readOnly
      if (c.required) field.flags |= FF.required
      continue
    }

    let flags = 0
    if (c.readonly) flags |= FF.readOnly
    if (c.required) flags |= FF.required
    if (c.kind === 'multiline') flags |= FF.multiline
    if (c.kind === 'password') { flags |= FF.password; passwords++ }
    if (c.kind === 'select' && !c.listbox) flags |= FF.combo
    if (c.kind === 'select' && c.multiple) flags |= FF.multiSelect

    // A value the base-14 fonts cannot draw still belongs in /V — pdfTextString
    // carries any codepoint — but our synthesized appearance cannot paint it, so
    // the viewer must be told to draw its own.
    const value = c.kind === 'password' ? '' : (c.value || '')
    if (value && pdfString(value) === null) needAppearances = true

    fields.push({
      kind: c.kind, wantedName: c.name || c.id || null, label: c.label,
      flags, members: [{ i, control: c }],
    })
    for (const r of c.runs || []) suppressed.add(r)
  }

  // Radio value runs do not exist (no text), but their names settle with
  // everything else's, in document order.
  for (const field of fields) field.name = uniqueName(field.wantedName)

  if (skippedTransform) {
    report(`${skippedTransform} form control(s) did not become a fillable field — a rotated or ` +
      'skewed control cannot carry an axis-aligned widget. Their values stay in the text layer.')
  }
  if (skippedClipped) {
    report(`${skippedClipped} form control(s) did not become a fillable field — an overflow clip ` +
      'hides part of them, and a widget must not reach outside what the capture shows.')
  }
  if (renamed) {
    report(`${renamed} duplicate field name(s) uniquified with a suffix — PDF fields sharing a ` +
      'name share one value, which HTML controls do not.')
  }
  if (passwords) {
    report(`${passwords} password field(s) written empty: a fillable field's value is plain text ` +
      'in the file, and a password must never be. The painted bullets leave the page with it.')
  }
  if (needAppearances) {
    report('a field value is outside base-14 — /NeedAppearances is set so the viewer draws it ' +
      'with its own fonts.')
  }
  return { fields, suppressed, needAppearances }
}

/**
 * Byte writer for the planned fields. One instance per export.
 *
 * Every widget id is RESERVED when its page is drawn — the page's /Annots needs
 * it then — and FILLED at `finish()`, because a radio member needs its parent
 * field's id and a tagged widget needs its /StructParent key, and neither exists
 * until every page is done. The same deferral the page tree itself uses.
 */
export function createFieldWriter(doc, { report }) {
  let helv = null
  const helvId = () => {
    if (helv === null) {
      helv = doc.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    }
    return helv
  }
  const placed = new Map()
  let straddled = 0

  /** Ops painting the synthesized face: background always opaque — the widget
   * owns its pixels, and a translucent face would show stale page ink under the
   * new value the day the field is edited. */
  const faceOps = (c, w, h, { withBorder = true } = {}) => {
    const ops = []
    const bg = c.style.bg || [1, 1, 1]
    ops.push(`${rgb(bg)} rg 0 0 ${num(w)} ${num(h)} re f`)
    if (withBorder && c.style.borderW > 0) {
      const bw = Math.min(c.style.borderW, w / 2, h / 2)
      ops.push(`${rgb(c.style.border || [0.6, 0.6, 0.6])} RG ${num(bw)} w ` +
        `${num(bw / 2)} ${num(bw / 2)} ${num(w - bw)} ${num(h - bw)} re S`)
    }
    return ops
  }

  /** The control's own crop of the capture, filling the widget box. */
  const cropOps = (w, h) => [`q ${num(w)} 0 0 ${num(h)} 0 0 cm /Ic Do Q`]

  /** One appearance stream: a Form XObject over the widget's own box. */
  const ap = (w, h, ops, resources = '') =>
    doc.addStream(
      `/Type /XObject /Subtype /Form /BBox [0 0 ${num(w)} ${num(h)}]` +
      (resources ? ` /Resources << ${resources} >>` : ''),
      ops.join('\n')
    )

  /** The check mark, drawn as a path so no dingbat font travels. */
  const checkOps = (c, w, h) => {
    const s = Math.min(w, h)
    const x = (w - s) / 2
    const y = (h - s) / 2
    return [
      `${rgb(c.style.color || [0, 0, 0])} RG ${num(Math.max(1, s * 0.12))} w 1 J 1 j`,
      `${num(x + s * 0.22)} ${num(y + s * 0.52)} m ` +
      `${num(x + s * 0.44)} ${num(y + s * 0.28)} l ` +
      `${num(x + s * 0.78)} ${num(y + s * 0.72)} l S`,
    ]
  }

  /** Four beziers approximating a circle around the box centre. */
  const circlePath = (w, h, r) => {
    const cx = w / 2
    const cy = h / 2
    const k = r * 0.5523
    return `${num(cx + r)} ${num(cy)} m ` +
      `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c ` +
      `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ` +
      `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c ` +
      `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c`
  }

  /** A filled circle — the radio dot. */
  const dotOps = (c, w, h) => [
    `${rgb(c.style.color || [0, 0, 0])} rg`,
    `${circlePath(w, h, Math.min(w, h) * 0.22)} f`,
  ]

  /** A native control's own computed border is 0 — its chrome is themed paint —
   * so a synthesized check/radio takes this stroke instead of vanishing into
   * the page as a bare white shape. */
  const CHROME = [0.45, 0.48, 0.53]

  /** The radio's ring. Always a circle: a radio with a square border is a lie. */
  const ringOps = (c, w, h) => {
    const bw = c.style.borderW > 0 ? Math.min(c.style.borderW, 2) : 1
    return [
      `${rgb(c.style.border || CHROME)} RG ${num(bw)} w`,
      `${circlePath(w, h, Math.min(w, h) / 2 - bw / 2)} S`,
    ]
  }

  /** The checkbox's square border, with the same native-chrome fallback. */
  const boxOps = (c, w, h) => {
    const bw = c.style.borderW > 0 ? Math.min(c.style.borderW, 2) : 1
    return [
      `${rgb(c.style.border || CHROME)} RG ${num(bw)} w ` +
      `${num(bw / 2)} ${num(bw / 2)} ${num(w - bw)} ${num(h - bw)} re S`,
    ]
  }

  /**
   * The value as visible text operators.
   *
   * The preferred source is `lines` — the control's own runs from the text
   * layer, re-based into the widget's box — because they carry the REAL layout:
   * a textarea's wrap, an input's alignment, a scrolled value's offset. The
   * single centred line is the fallback for a control measured without them.
   */
  const valueOps = (c, w, h, sizePt, lines) => {
    if (lines && lines.length) {
      const ops = [`${rgb(c.style.color || [0, 0, 0])} rg`]
      for (const line of lines) {
        const str = pdfString(line.text)
        if (!str) continue
        ops.push(`BT /Fh ${num(line.size)} Tf ${num(line.x)} ${num(line.y)} Td ${str} Tj ET`)
      }
      if (ops.length > 1) return ops
    }
    const value = displayValue(c)
    if (!value) return []
    const line = c.kind === 'multiline' ? value.split('\n')[0] : value
    const str = pdfString(line)
    if (!str) return [] // NeedAppearances covers it; planFields already reported.
    const pad = Math.max(2, sizePt * 0.35)
    const y = c.kind === 'multiline' ? h - sizePt - pad : (h - sizePt) / 2 + sizePt * 0.18
    return [
      `${rgb(c.style.color || [0, 0, 0])} rg`,
      `BT /Fh ${num(sizePt)} Tf ${num(pad)} ${num(y)} Td ${str} Tj ET`,
    ]
  }

  /** The combo's disclosure arrow, so a synthesized select still reads as one. */
  const arrowOps = (c, w, h) => {
    const s = Math.min(h * 0.22, 5)
    const cx = w - s * 2.2
    const cy = h / 2
    return [
      '0.42 0.45 0.5 rg',
      `${num(cx - s)} ${num(cy + s * 0.55)} m ${num(cx + s)} ${num(cy + s * 0.55)} l ` +
      `${num(cx)} ${num(cy - s * 0.65)} l f`,
    ]
  }

  return {
    /** Count a widget clamped to one page of a control that crossed a break. */
    straddle() { straddled++ },

    /**
     * Reserve one widget on a page. Returns its object id for /Annots — and for
     * the structure registry, whose OBJR must point at the same object.
     *
     * @param {object} field  a `planFields` field
     * @param {object} member  the field member drawn on this page
     * @param {[number,number,number,number]} rect  page points, [llx lly urx ury]
     * @param {number} sizePt  the value's type size on the page
     * @param {number|null} cropId  image XObject of the control's own raster crop
     */
    widget(field, member, rect, sizePt, cropId, lines = null) {
      const id = doc.reserve()
      placed.set(member, { field, member, rect, sizePt, cropId, lines, id })
      return id
    },

    /**
     * Write every field and widget; return the catalog's /AcroForm value.
     * @param {(member: object) => number|null} structKey  the widget's
     *   /StructParent key, or null when untagged
     */
    finish(structKey, needAppearances) {
      if (!placed.size) return null
      const fieldRefs = []
      const byField = new Map()
      for (const entry of placed.values()) {
        if (!byField.has(entry.field)) byField.set(entry.field, [])
        byField.get(entry.field).push(entry)
      }
      if (straddled) {
        report(`${straddled} field annotation(s) straddle a page break and were clamped to one ` +
          'page — a widget cannot span two.')
      }

      for (const [field, entries] of byField) {
        const c0 = entries[0].member.control
        const common =
          ` /T ${pdfTextString(field.name)}` +
          (field.label ? ` /TU ${pdfTextString(field.label)}` : '') +
          ` /Ff ${field.flags}`

        if (field.kind === 'radio') {
          const parentId = doc.reserve()
          // With /Opt present the appearance states are option indices, which
          // sidesteps every "is this value a legal /Name?" question.
          const opts = field.members.map(m => pdfTextString(m.control.value || 'on'))
          const checked = field.members.findIndex(m => m.control.checked)
          for (const entry of entries) {
            const idx = field.members.indexOf(entry.member)
            const c = entry.member.control
            const [llx, lly, urx, ury] = entry.rect
            const w = urx - llx
            const h = ury - lly
            const on = ap(w, h, [...faceOps(c, w, h, { withBorder: false }),
              ...ringOps(c, w, h), ...dotOps(c, w, h)])
            const off = ap(w, h, [...faceOps(c, w, h, { withBorder: false }), ...ringOps(c, w, h)])
            doc.fill(entry.id,
              `<< /Type /Annot /Subtype /Widget /Parent ${parentId} 0 R /F 4` +
              ` /Rect [${entry.rect.map(num).join(' ')}]` +
              ` /AS /${c.checked ? idx : 'Off'}` +
              ` /MK << /BG [${rgb(c.style.bg || [1, 1, 1])}] >>` +
              structRef(structKey(entry.member)) +
              ` /AP << /N << /${idx} ${on} 0 R /Off ${off} 0 R >> >> >>`)
          }
          doc.fill(parentId,
            `<< /FT /Btn${common} /V /${checked >= 0 ? checked : 'Off'}` +
            ` /Opt [${opts.join(' ')}]` +
            ` /Kids [${entries.map(e => `${e.id} 0 R`).join(' ')}] >>`)
          fieldRefs.push(`${parentId} 0 R`)
          continue
        }

        // Every other kind: one field, one widget, merged into one dictionary.
        const entry = entries[0]
        const [llx, lly, urx, ury] = entry.rect
        const w = urx - llx
        const h = ury - lly
        const c = c0
        let typed = ''
        let apRef = ''

        if (field.kind === 'checkbox') {
          const on = ap(w, h, [...faceOps(c, w, h, { withBorder: false }),
            ...boxOps(c, w, h), ...checkOps(c, w, h)])
          const off = ap(w, h, [...faceOps(c, w, h, { withBorder: false }), ...boxOps(c, w, h)])
          typed = ` /FT /Btn /V /${c.checked ? 'Yes' : 'Off'} /AS /${c.checked ? 'Yes' : 'Off'}`
          apRef = ` /AP << /N << /Yes ${on} 0 R /Off ${off} 0 R >> >>`
        } else {
          // An EMPTY field wears the control's own crop — pixel-exact border,
          // radius and placeholder, and nothing for PDFKit to redraw. A VALUED
          // field wears real text: PDFKit repaints /V over any appearance
          // carrying an image XObject, so the crop and a value cannot coexist.
          const crop = wantsCropAP(field, c) && entry.cropId !== null
          const face = faceOps(c, w, h, { withBorder: !crop })
          const body = crop ? [] : valueOps(c, w, h, entry.sizePt, entry.lines)
          const over = crop ? cropOps(w, h)
            : (field.kind === 'select' && !c.listbox ? arrowOps(c, w, h) : [])
          const resources = [
            crop ? `/XObject << /Ic ${entry.cropId} 0 R >>` : '',
            body.length ? `/Font << /Fh ${helvId()} 0 R >>` : '',
          ].filter(Boolean).join(' ')
          const stream = ap(w, h, [...face, ...body, ...over], resources)
          apRef = ` /AP << /N ${stream} 0 R >>`
          const da = ` /DA (${rgb(c.style.color || [0, 0, 0])} rg /Helv ${num(entry.sizePt)} Tf)` +
            ` /Q ${ALIGN[c.style.align] ?? 0}`

          if (field.kind === 'select') {
            const opts = c.options.map(o =>
              `[${pdfTextString(o.value)} ${pdfTextString(o.label)}]`).join(' ')
            const selected = c.options.filter(o => o.selected)
            const v = c.multiple
              ? ` /V [${selected.map(o => pdfTextString(o.value)).join(' ')}]`
              : (selected[0] ? ` /V ${pdfTextString(selected[0].value)}` : '')
            const indices = selected.map(o => c.options.indexOf(o))
            typed = ` /FT /Ch /Opt [${opts}]${v}` +
              (indices.length ? ` /I [${indices.join(' ')}]` : '') + da
          } else {
            const value = field.kind === 'password' ? '' : String(c.value || '')
            typed = ` /FT /Tx${value ? ` /V ${pdfTextString(value)}` : ''}` +
              (c.maxLength > 0 ? ` /MaxLen ${c.maxLength}` : '') + da
          }
        }

        doc.fill(entry.id,
          `<< /Type /Annot /Subtype /Widget /F 4` +
          ` /Rect [${entry.rect.map(num).join(' ')}]` +
          typed + common +
          ` /MK << /BG [${rgb(c.style.bg || [1, 1, 1])}]` +
          (c.style.borderW > 0 ? ` /BC [${rgb(c.style.border || [0.6, 0.6, 0.6])}]` : '') + ` >>` +
          (c.style.borderW > 0 ? ` /BS << /W ${num(Math.max(0.5, c.style.borderW))} /S /S >>` : '') +
          structRef(structKey(entry.member)) +
          apRef + ' >>')
        fieldRefs.push(`${entry.id} 0 R`)
      }

      return `<< /Fields [${fieldRefs.join(' ')}]` +
        ` /DR << /Font << /Helv ${helvId()} 0 R >> >> /DA (0 g /Helv 0 Tf)` +
        (needAppearances ? ' /NeedAppearances true' : '') + ' >>'
    },
  }
}

const structRef = (key) => (key === null || key === undefined) ? '' : ` /StructParent ${key}`
