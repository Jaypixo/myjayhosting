/*!
 * Remarker - a from-scratch Markdown parser/renderer.
 * Drop-in replacement for marked.js: same call shape (`remarker(src)` / `remarker.parse(src)`),
 * plus extensions: colored/highlighted spans, GitHub-style callouts, footnotes, a table of
 * contents, sized & embedded media, spoilers, kbd keys, and built-in syntax highlighting.
 *
 * Usage (browser):
 *   <script src="remarker.js"></script>
 *   <script>document.body.innerHTML = remarker.parse('# Hello **world**');</script>
 *
 * Usage (Node):
 *   const remarker = require('./remarker.js');
 *   remarker.parse('# Hello **world**');
 *
 * Standard Markdown (CommonMark-ish) keeps working unmodified - the extensions only trigger
 * on syntax that plain Markdown does not otherwise use (e.g. `==`, `||`, `[[ ]]`, `{ }` spans).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var lib = factory();
    root.remarker = lib;
    root.Remarker = lib;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ----------------------------------------------------------------------
  // Generic helpers
  // ----------------------------------------------------------------------

  var HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // Blocks "javascript:" and non-image data: URIs to avoid script-injection via links/images.
  function safeHref(href) {
    var h = String(href == null ? '' : href).trim();
    if (/^javascript:/i.test(h) || /^vbscript:/i.test(h)) return '#';
    if (/^data:/i.test(h) && !/^data:image\/(png|gif|jpe?g|webp|svg\+xml);/i.test(h)) return '#';
    return h;
  }

  function repeat(str, n) { var out = ''; for (var i = 0; i < n; i++) out += str; return out; }

  function slugify(text, used) {
    var slug = String(text).toLowerCase().trim()
      .replace(/<[^>]*>/g, '')
      .replace(/[`*_~^|=:\[\](){}!#.,'"?<>\/\\]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slug) slug = 'section';
    if (used[slug] == null) { used[slug] = 0; return slug; }
    used[slug]++;
    return slug + '-' + used[slug];
  }

  // ----------------------------------------------------------------------
  // Data tables for extensions
  // ----------------------------------------------------------------------

  var CALLOUTS = {
    note: { label: 'Note', cls: 'note' },
    tip: { label: 'Tip', cls: 'tip' },
    important: { label: 'Important', cls: 'important' },
    warning: { label: 'Warning', cls: 'warning' },
    caution: { label: 'Caution', cls: 'caution' },
    danger: { label: 'Danger', cls: 'caution' },
    success: { label: 'Success', cls: 'success' }
  };

  var LANG_ALIASES = {
    javascript: 'js', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
    typescript: 'ts', ts: 'ts', tsx: 'tsx',
    py: 'python', python: 'python', python3: 'python',
    sh: 'bash', shell: 'bash', bash: 'bash', zsh: 'bash', console: 'bash',
    yml: 'yaml', yaml: 'yaml', json: 'json', json5: 'json',
    html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
    css: 'css', scss: 'css', less: 'css',
    java: 'java', kotlin: 'java', kt: 'java',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', 'c++': 'cpp', hpp: 'cpp',
    cs: 'csharp', csharp: 'csharp',
    go: 'go', golang: 'go',
    rust: 'rust', rs: 'rust',
    php: 'php', rb: 'ruby', ruby: 'ruby', sql: 'sql', md: 'markdown', markdown: 'markdown',
    diff: 'diff', text: 'text', plaintext: 'text', plain: 'text'
  };
  function normalizeLang(lang) {
    lang = (lang || '').toLowerCase().trim();
    return LANG_ALIASES[lang] || lang;
  }

  var KEYWORDS_JS = ['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in',
    'instanceof', 'let', 'new', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try',
    'typeof', 'var', 'void', 'while', 'with', 'yield', 'async', 'await', 'of', 'get', 'set'];
  var KEYWORDS = {
    js: KEYWORDS_JS, jsx: KEYWORDS_JS,
    ts: KEYWORDS_JS.concat(['interface', 'type', 'enum', 'implements', 'namespace', 'declare', 'readonly', 'public', 'private', 'protected', 'as', 'is', 'keyof']),
    tsx: KEYWORDS_JS.concat(['interface', 'type', 'enum', 'implements', 'namespace', 'declare', 'readonly', 'public', 'private', 'protected', 'as']),
    python: ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with',
      'as', 'import', 'from', 'return', 'yield', 'lambda', 'pass', 'break', 'continue', 'global',
      'nonlocal', 'assert', 'del', 'raise', 'in', 'is', 'not', 'and', 'or', 'async', 'await', 'self'],
    bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function',
      'return', 'exit', 'export', 'local', 'echo', 'read', 'in'],
    json: [], css: [], html: [], xml: [], yaml: [], sql: ['SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO',
      'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON',
      'GROUP', 'BY', 'ORDER', 'LIMIT', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'DROP', 'ALTER'],
    markdown: [], diff: [], text: [],
    java: ['class', 'interface', 'extends', 'implements', 'public', 'private', 'protected', 'static',
      'final', 'void', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
      'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package', 'this', 'super'],
    c: ['int', 'char', 'float', 'double', 'void', 'long', 'short', 'unsigned', 'signed', 'struct',
      'union', 'enum', 'typedef', 'static', 'const', 'return', 'if', 'else', 'for', 'while', 'do',
      'switch', 'case', 'break', 'continue', 'sizeof', '#include', '#define'],
    cpp: ['int', 'char', 'float', 'double', 'void', 'long', 'short', 'class', 'struct', 'public',
      'private', 'protected', 'template', 'typename', 'namespace', 'using', 'new', 'delete', 'return',
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'const', 'static',
      'virtual', 'override', 'auto'],
    csharp: ['class', 'interface', 'namespace', 'using', 'public', 'private', 'protected', 'static',
      'void', 'var', 'new', 'return', 'if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case',
      'break', 'continue', 'try', 'catch', 'finally', 'throw', 'async', 'await'],
    go: ['func', 'package', 'import', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan',
      'go', 'defer', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'break', 'continue', 'nil'],
    rust: ['fn', 'let', 'mut', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'match', 'if',
      'else', 'for', 'while', 'loop', 'return', 'break', 'continue', 'self', 'Self', 'as', 'const'],
    php: ['function', 'class', 'extends', 'implements', 'public', 'private', 'protected', 'static',
      'echo', 'print', 'return', 'if', 'else', 'elseif', 'for', 'foreach', 'while', 'do', 'switch',
      'case', 'break', 'continue', 'new', 'namespace', 'use', '$this'],
    ruby: ['def', 'class', 'module', 'end', 'if', 'elsif', 'else', 'unless', 'for', 'while', 'do',
      'case', 'when', 'break', 'next', 'return', 'yield', 'require', 'attr_accessor', 'self']
  };
  var LANG_COMMENTS = {
    js: { line: '//', block: ['/*', '*/'] }, jsx: { line: '//', block: ['/*', '*/'] },
    ts: { line: '//', block: ['/*', '*/'] }, tsx: { line: '//', block: ['/*', '*/'] },
    java: { line: '//', block: ['/*', '*/'] }, c: { line: '//', block: ['/*', '*/'] },
    cpp: { line: '//', block: ['/*', '*/'] }, csharp: { line: '//', block: ['/*', '*/'] },
    go: { line: '//', block: ['/*', '*/'] }, rust: { line: '//', block: ['/*', '*/'] },
    php: { line: '//', block: ['/*', '*/'] }, css: { block: ['/*', '*/'] },
    python: { line: '#' }, bash: { line: '#' }, yaml: { line: '#' }, ruby: { line: '#' },
    sql: { line: '--' }, html: {}, xml: {}, json: {}, markdown: {}, diff: {}, text: {}
  };

  var BOOL_WORD = /^(true|false|null|undefined|nil|none|nan|this|self)$/i;

  function highlightCode(code, lang) {
    var kw = {};
    (KEYWORDS[lang] || []).forEach(function (w) { kw[w] = true; });
    var comments = LANG_COMMENTS[lang] || {};
    var out = '';
    var i = 0, n = code.length;
    while (i < n) {
      var rest = code.slice(i);

      if (comments.block && rest.indexOf(comments.block[0]) === 0) {
        var endB = code.indexOf(comments.block[1], i + comments.block[0].length);
        var stopB = endB === -1 ? n : endB + comments.block[1].length;
        out += '<span class="tok-comment">' + escapeHtml(code.slice(i, stopB)) + '</span>';
        i = stopB; continue;
      }
      if (comments.line && rest.indexOf(comments.line) === 0) {
        var endL = code.indexOf('\n', i);
        if (endL === -1) endL = n;
        out += '<span class="tok-comment">' + escapeHtml(code.slice(i, endL)) + '</span>';
        i = endL; continue;
      }
      if ((lang === 'html' || lang === 'xml' || lang === 'markdown') && rest.indexOf('<!--') === 0) {
        var endC = code.indexOf('-->', i);
        var stopC = endC === -1 ? n : endC + 3;
        out += '<span class="tok-comment">' + escapeHtml(code.slice(i, stopC)) + '</span>';
        i = stopC; continue;
      }

      var strMatch = /^("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/.exec(rest);
      if (strMatch) {
        out += '<span class="tok-string">' + escapeHtml(strMatch[0]) + '</span>';
        i += strMatch[0].length; continue;
      }

      var numMatch = /^(0[xX][0-9a-fA-F]+|\d+(\.\d+)?([eE][+-]?\d+)?)\b/.exec(rest);
      if (numMatch) {
        out += '<span class="tok-number">' + escapeHtml(numMatch[0]) + '</span>';
        i += numMatch[0].length; continue;
      }

      var idMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
      if (idMatch) {
        var word = idMatch[0];
        var after = rest.slice(word.length);
        if (kw[word] || kw[word.toUpperCase()]) {
          out += '<span class="tok-keyword">' + escapeHtml(word) + '</span>';
        } else if (BOOL_WORD.test(word)) {
          out += '<span class="tok-boolean">' + escapeHtml(word) + '</span>';
        } else if (/^\s*\(/.test(after)) {
          out += '<span class="tok-function">' + escapeHtml(word) + '</span>';
        } else {
          out += escapeHtml(word);
        }
        i += word.length; continue;
      }

      out += escapeHtml(rest[0]);
      i += 1;
    }
    return out;
  }

  // ----------------------------------------------------------------------
  // Block-level lexer (line based, recursion handles nesting)
  // ----------------------------------------------------------------------

  var RE_FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^\n`]*)$/;
  var RE_FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
  var RE_ATX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  var RE_HR = /^\s{0,3}((-[ \t]*){3,}|(\*[ \t]*){3,}|(_[ \t]*){3,})$/;
  var RE_SETEXT_1 = /^\s{0,3}=+\s*$/;
  var RE_SETEXT_2 = /^\s{0,3}-{2,}\s*$/;
  var RE_FOOTDEF = /^\[\^([^\]]+)\]:\s?(.*)$/;
  var RE_LINKDEF = /^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+"([^"]*)")?\s*$/;
  var RE_BLOCKQUOTE = /^\s{0,3}>\s?/;
  var RE_LIST_ITEM = /^(\s{0,3})([-*+]|\d{1,9}[.)])\s+(.*)$/;
  var RE_TABLE_DELIM = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  var RE_HTML_BLOCK = /^\s{0,3}<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s|\/?>|$)/;
  var RE_INDENTED_CODE = /^ {4}\S/;

  function isBlockStart(lines, idx) {
    var line = lines[idx];
    if (RE_ATX.test(line) ||
      RE_FENCE.test(line) ||
      RE_BLOCKQUOTE.test(line) ||
      RE_LIST_ITEM.test(line) ||
      RE_HR.test(line) ||
      /^\[TOC\]\s*$/i.test(line.trim())) {
      return true;
    }
    // A table header followed by a valid delimiter row interrupts a paragraph
    // too, so "intro text:\n| a | b |\n| - | - |" is recognized without a
    // blank line in between (matches GFM behavior).
    if (idx + 1 < lines.length && line.indexOf('|') !== -1 &&
      RE_TABLE_DELIM.test(lines[idx + 1]) && lines[idx + 1].indexOf('-') !== -1) {
      return true;
    }
    return false;
  }

  function splitTableRow(line) {
    var t = line.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|' && t.charAt(t.length - 2) !== '\\') t = t.slice(0, -1);
    return t.split(/(?<!\\)\|/).map(function (c) { return c.trim().replace(/\\\|/g, '|'); });
  }

  function parseBlocks(lines) {
    var tokens = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { i++; continue; }

      // fenced code block
      var m = RE_FENCE.exec(line);
      if (m) {
        var indent = m[1].length, fence = m[2], lang = m[3].trim();
        var fenceChar = fence[0], fenceLen = fence.length;
        var j = i + 1, codeLines = [];
        while (j < lines.length) {
          var close = RE_FENCE_CLOSE.exec(lines[j]);
          if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) { j++; break; }
          codeLines.push(lines[j].replace(new RegExp('^ {0,' + indent + '}'), ''));
          j++;
        }
        tokens.push({ type: 'code', lang: lang, text: codeLines.join('\n') });
        i = j; continue;
      }

      // ATX heading
      m = RE_ATX.exec(line);
      if (m) { tokens.push({ type: 'heading', depth: m[1].length, text: m[2] }); i++; continue; }

      // table of contents marker
      if (/^\[TOC\]\s*$/i.test(line.trim())) { tokens.push({ type: 'toc' }); i++; continue; }

      // horizontal rule
      if (RE_HR.test(line)) { tokens.push({ type: 'hr' }); i++; continue; }

      // setext headings
      if (i + 1 < lines.length && line.trim() !== '' && !isBlockStart(lines, i)) {
        if (RE_SETEXT_1.test(lines[i + 1])) { tokens.push({ type: 'heading', depth: 1, text: line.trim() }); i += 2; continue; }
        if (RE_SETEXT_2.test(lines[i + 1])) { tokens.push({ type: 'heading', depth: 2, text: line.trim() }); i += 2; continue; }
      }

      // footnote definition
      m = RE_FOOTDEF.exec(line);
      if (m) {
        var jf = i + 1, defLines = [m[2]];
        while (jf < lines.length && /^(\t| {2,4})\S/.test(lines[jf])) { defLines.push(lines[jf].replace(/^(\t| {1,4})/, '')); jf++; }
        tokens.push({ type: 'footnoteDef', id: m[1], text: defLines.join('\n') });
        i = jf; continue;
      }

      // link reference definition
      m = RE_LINKDEF.exec(line);
      if (m) { tokens.push({ type: 'def', tag: m[1].toLowerCase().trim(), href: m[2], title: m[3] }); i++; continue; }

      // blockquote (and GitHub-style callouts)
      if (RE_BLOCKQUOTE.test(line)) {
        var jq = i, bqLines = [];
        // Simplification: continuation lines must keep the leading `>` marker (no CommonMark
        // "lazy continuation" of un-prefixed lines) - keeps the recursive parse unambiguous.
        while (jq < lines.length && RE_BLOCKQUOTE.test(lines[jq])) {
          bqLines.push(lines[jq].replace(RE_BLOCKQUOTE, ''));
          jq++;
        }
        var calloutType = null;
        if (bqLines.length) {
          var cm = /^\[!(\w+)\]\s*$/.exec(bqLines[0].trim());
          if (cm && CALLOUTS[cm[1].toLowerCase()]) { calloutType = cm[1].toLowerCase(); bqLines.shift(); }
        }
        tokens.push({ type: 'blockquote', callout: calloutType, tokens: parseBlocks(bqLines) });
        i = jq; continue;
      }

      // GFM table
      if (i + 1 < lines.length && line.indexOf('|') !== -1 && RE_TABLE_DELIM.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
        var header = splitTableRow(line);
        var alignRow = splitTableRow(lines[i + 1]);
        var aligns = alignRow.map(function (c) {
          var t = c.trim();
          if (/^:-+:$/.test(t)) return 'center';
          if (/^-+:$/.test(t)) return 'right';
          if (/^:-+$/.test(t)) return 'left';
          return null;
        });
        var jt = i + 2, rows = [];
        while (jt < lines.length && lines[jt].indexOf('|') !== -1 && lines[jt].trim() !== '') {
          rows.push(splitTableRow(lines[jt]));
          jt++;
        }
        tokens.push({ type: 'table', header: header, aligns: aligns, rows: rows });
        i = jt; continue;
      }

      // list
      m = RE_LIST_ITEM.exec(line);
      if (m) {
        var ordered = /\d/.test(m[2]);
        var startNum = ordered ? parseInt(m[2], 10) : null;
        var items = [];
        var jl = i;
        var loose = false;
        while (jl < lines.length) {
          if (/^\s*$/.test(lines[jl])) {
            var k = jl;
            while (k < lines.length && /^\s*$/.test(lines[k])) k++;
            if (k < lines.length) {
              var nextItem = RE_LIST_ITEM.exec(lines[k]);
              if (nextItem && /\d/.test(nextItem[2]) === ordered) { loose = true; jl = k; }
              else break;
            } else break;
          }
          var itemMatch = RE_LIST_ITEM.exec(lines[jl]);
          if (!itemMatch) break;
          if (/\d/.test(itemMatch[2]) !== ordered) break;
          var prefixMatch = /^(\s*([-*+]|\d{1,9}[.)])\s+)/.exec(lines[jl]);
          var contentIndent = prefixMatch[1].length;
          var itemLines = [itemMatch[3]];
          jl++;
          while (jl < lines.length) {
            if (/^\s*$/.test(lines[jl])) {
              var k2 = jl;
              while (k2 < lines.length && /^\s*$/.test(lines[k2])) k2++;
              if (k2 < lines.length && lines[k2].slice(0, contentIndent).trim() === '' &&
                  lines[k2].length > contentIndent && lines[k2].charAt(contentIndent) !== undefined &&
                  /\S/.test(lines[k2].slice(contentIndent, contentIndent + 1))) {
                loose = true; itemLines.push(''); jl++; continue;
              }
              break;
            }
            var lineIndent = /^\s*/.exec(lines[jl])[0].length;
            if (lineIndent >= contentIndent) { itemLines.push(lines[jl].slice(contentIndent)); jl++; }
            else break;
          }
          while (itemLines.length && itemLines[itemLines.length - 1].trim() === '') itemLines.pop();
          var checked = null;
          if (/^\[[ xX]\]\s+/.test(itemLines[0])) {
            checked = /^\[[xX]\]/.test(itemLines[0]);
            itemLines[0] = itemLines[0].replace(/^\[[ xX]\]\s+/, '');
          }
          items.push({ checked: checked, tokens: parseBlocks(itemLines) });
        }
        tokens.push({ type: 'list', ordered: ordered, start: startNum, loose: loose, items: items });
        i = jl; continue;
      }

      // indented code block
      if (RE_INDENTED_CODE.test(line)) {
        var ji = i, icLines = [];
        while (ji < lines.length && (/^ {4}/.test(lines[ji]) || /^\s*$/.test(lines[ji]))) {
          icLines.push(lines[ji].replace(/^ {4}/, ''));
          ji++;
        }
        while (icLines.length && icLines[icLines.length - 1].trim() === '') icLines.pop();
        tokens.push({ type: 'code', lang: '', text: icLines.join('\n') });
        i = ji; continue;
      }

      // raw HTML block
      if (RE_HTML_BLOCK.test(line)) {
        var jh = i, htmlLines = [];
        while (jh < lines.length && lines[jh].trim() !== '') { htmlLines.push(lines[jh]); jh++; }
        tokens.push({ type: 'html', text: htmlLines.join('\n') });
        i = jh; continue;
      }

      // paragraph (fallback)
      {
        var jp = i, paraLines = [line];
        jp++;
        while (jp < lines.length && lines[jp].trim() !== '' && !isBlockStart(lines, jp)) { paraLines.push(lines[jp]); jp++; }
        tokens.push({ type: 'paragraph', text: paraLines.join('\n') });
        i = jp; continue;
      }
    }
    return tokens;
  }

  // ----------------------------------------------------------------------
  // Inline lexer/renderer
  // ----------------------------------------------------------------------

  var COLOR_VALUE_RE = /^(#(?:[0-9a-fA-F]{3,4}){1,2}|rgba?\([^)]+\)|hsla?\([^)]+\))$/;
  var SAFE_CSS_VALUE = /^[#a-zA-Z0-9.,()%\s-]{1,64}$/;

  function parseSpanAttrs(attrStr) {
    var classes = [], styles = [];
    var re = /\.([\w-]+)|([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*'([^']*)'|([\w-]+)\s*=\s*(\S+)/g;
    var m;
    while ((m = re.exec(attrStr))) {
      if (m[1]) { classes.push(m[1]); continue; }
      var key = (m[2] || m[4] || m[6] || '').toLowerCase();
      var val = m[3] != null ? m[3] : (m[5] != null ? m[5] : m[7]);
      if (!val || !SAFE_CSS_VALUE.test(val)) continue;
      if (key === 'color') styles.push('color:' + val);
      else if (key === 'bg' || key === 'background') styles.push('background-color:' + val);
      else if (key === 'size') styles.push('font-size:' + val);
    }
    return { classes: classes, styles: styles };
  }

  var VIDEO_EXT = /\.(mp4|webm|ogv|mov)(\?\S*)?$/i;
  var AUDIO_EXT = /\.(mp3|wav|flac|m4a|ogg)(\?\S*)?$/i;
  var YT_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/i;
  var VIMEO_RE = /vimeo\.com\/(\d+)/i;

  function renderMedia(alt, url, title, width, height) {
    var safe = safeHref(url);
    var yt = YT_RE.exec(safe);
    var vimeo = !yt && VIMEO_RE.exec(safe);
    if (yt) {
      return '<span class="md-embed-wrap"><iframe class="md-embed" src="https://www.youtube.com/embed/' +
        escapeAttr(yt[1]) + '" title="' + escapeAttr(alt || 'YouTube video') +
        '" loading="lazy" allowfullscreen frameborder="0"></iframe></span>';
    }
    if (vimeo) {
      return '<span class="md-embed-wrap"><iframe class="md-embed" src="https://player.vimeo.com/video/' +
        escapeAttr(vimeo[1]) + '" title="' + escapeAttr(alt || 'Vimeo video') +
        '" loading="lazy" allowfullscreen frameborder="0"></iframe></span>';
    }
    if (VIDEO_EXT.test(safe)) {
      return '<video class="md-video" controls preload="metadata" src="' + escapeAttr(safe) + '"' +
        (width ? ' width="' + escapeAttr(width) + '"' : '') +
        (height ? ' height="' + escapeAttr(height) + '"' : '') + '>' + escapeHtml(alt) + '</video>';
    }
    if (AUDIO_EXT.test(safe)) {
      return '<audio class="md-audio" controls preload="metadata" src="' + escapeAttr(safe) + '"></audio>';
    }
    return '<img src="' + escapeAttr(safe) + '" alt="' + escapeAttr(alt) + '"' +
      (title ? ' title="' + escapeAttr(title) + '"' : '') +
      (width ? ' width="' + escapeAttr(width) + '"' : '') +
      (height ? ' height="' + escapeAttr(height) + '"' : '') + ' loading="lazy">';
  }

  function renderCodeSpan(content) {
    var trimmed = content.trim();
    var swatch = '';
    if (COLOR_VALUE_RE.test(trimmed)) {
      swatch = '<span class="md-swatch" style="background:' + escapeAttr(trimmed) + '"></span>';
    }
    return swatch + '<code>' + escapeHtml(content) + '</code>';
  }

  function renderInline(text, ctx) {
    var out = '';
    var src = text;
    var m;

    while (src.length) {
      // escaped character
      m = /^\\([\\`*_{}\[\]()#+\-.!~^|=:<>])/.exec(src);
      if (m) { out += escapeHtml(m[1]); src = src.slice(m[0].length); continue; }

      // code spans (`` for content with backticks, ` for simple spans)
      m = /^``([\s\S]+?)``/.exec(src);
      if (m) { out += renderCodeSpan(m[1]); src = src.slice(m[0].length); continue; }
      m = /^`([^`\n]+?)`/.exec(src);
      if (m) { out += renderCodeSpan(m[1]); src = src.slice(m[0].length); continue; }

      // kbd keys [[Key]]
      m = /^\[\[([^\[\]]+)\]\]/.exec(src);
      if (m) { out += '<kbd>' + escapeHtml(m[1]) + '</kbd>'; src = src.slice(m[0].length); continue; }

      // footnote reference [^id]
      m = /^\[\^([^\]\s]+)\]/.exec(src);
      if (m) {
        if (ctx.footnotes[m[1]]) {
          var idx = ctx.footnoteOrder.indexOf(m[1]);
          if (idx === -1) { ctx.footnoteOrder.push(m[1]); idx = ctx.footnoteOrder.length - 1; }
          out += '<sup id="fnref-' + escapeAttr(m[1]) + '" class="md-fnref"><a href="#fn-' +
            escapeAttr(m[1]) + '">[' + (idx + 1) + ']</a></sup>';
        } else {
          out += escapeHtml(m[0]);
        }
        src = src.slice(m[0].length); continue;
      }

      // images (with optional title + Typora-style =WxH sizing) & smart media embeds
      m = /^!\[((?:[^\[\]\\]|\\.)*)\]\(\s*([^)]*)\)/.exec(src);
      if (m) {
        var alt = m[1].replace(/\\([\\`*_{}\[\]()#+\-.!~^|=:<>])/g, '$1');
        var inside = /^\s*(\S+)(?:\s+"([^"]*)")?(?:\s+=(\d*)x(\d*))?\s*$/.exec(m[2]);
        if (inside) {
          out += renderMedia(alt, inside[1], inside[2], inside[3], inside[4]);
        } else {
          out += renderMedia(alt, m[2].trim(), '', '', '');
        }
        src = src.slice(m[0].length); continue;
      }

      // colored / styled span: [text]{color="red" bg="#222" .class}
      m = /^\[((?:[^\[\]]|\\.)*)\]\{([^}]*)\}/.exec(src);
      if (m) {
        var attrs = parseSpanAttrs(m[2]);
        var clsAttr = attrs.classes.length ? ' class="' + escapeAttr(attrs.classes.join(' ')) + '"' : '';
        var styleAttr = attrs.styles.length ? ' style="' + escapeAttr(attrs.styles.join(';')) + '"' : '';
        out += '<span' + clsAttr + styleAttr + '>' + renderInline(m[1], ctx) + '</span>';
        src = src.slice(m[0].length); continue;
      }

      // inline link [text](url "title")
      m = /^\[((?:[^\[\]]|\\.)*)\]\(\s*([^)]*)\)/.exec(src);
      if (m) {
        var linkInside = /^\s*<?([^\s>]*)>?(?:\s+"([^"]*)")?\s*$/.exec(m[2]);
        var href = linkInside ? linkInside[1] : m[2].trim();
        var title = linkInside ? linkInside[2] : '';
        out += '<a href="' + escapeAttr(safeHref(href)) + '"' + (title ? ' title="' + escapeAttr(title) + '"' : '') + '>' +
          renderInline(m[1], ctx) + '</a>';
        src = src.slice(m[0].length); continue;
      }

      // reference link [text][ref]
      m = /^\[((?:[^\[\]]|\\.)*)\]\[([^\]]*)\]/.exec(src);
      if (m) {
        var label1 = (m[2] || m[1]).toLowerCase().trim();
        var def1 = ctx.refs[label1];
        if (def1) {
          out += '<a href="' + escapeAttr(safeHref(def1.href)) + '"' + (def1.title ? ' title="' + escapeAttr(def1.title) + '"' : '') + '>' +
            renderInline(m[1], ctx) + '</a>';
          src = src.slice(m[0].length); continue;
        }
      }

      // shortcut reference link [text]
      m = /^\[((?:[^\[\]]|\\.)*)\]/.exec(src);
      if (m && src.charAt(m[0].length) !== '(' && src.charAt(m[0].length) !== '{') {
        var label2 = m[1].toLowerCase().trim();
        var def2 = ctx.refs[label2];
        if (def2) {
          out += '<a href="' + escapeAttr(safeHref(def2.href)) + '"' + (def2.title ? ' title="' + escapeAttr(def2.title) + '"' : '') + '>' +
            renderInline(m[1], ctx) + '</a>';
          src = src.slice(m[0].length); continue;
        }
      }

      // autolink <http://...> or <email>
      m = /^<((?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|mailto:)[^\s<>]+|[^\s<>@]+@[^\s<>]+\.[a-zA-Z]+)>/.exec(src);
      if (m) {
        var au = m[1];
        var isEmail = au.indexOf('@') !== -1 && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(au);
        var ahref = isEmail ? 'mailto:' + au : au;
        out += '<a href="' + escapeAttr(safeHref(ahref)) + '">' + escapeHtml(au) + '</a>';
        src = src.slice(m[0].length); continue;
      }

      // raw inline HTML passthrough
      m = /^<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*?)?\s*\/?>/.exec(src);
      if (m) {
        out += ctx.options.sanitize ? escapeHtml(m[0]) : m[0];
        src = src.slice(m[0].length); continue;
      }

      // strong + emphasis combined
      m = /^\*\*\*([\s\S]+?)\*\*\*/.exec(src);
      if (m) { out += '<strong><em>' + renderInline(m[1], ctx) + '</em></strong>'; src = src.slice(m[0].length); continue; }
      m = /^___([\s\S]+?)___/.exec(src);
      if (m) { out += '<strong><em>' + renderInline(m[1], ctx) + '</em></strong>'; src = src.slice(m[0].length); continue; }

      // strong
      m = /^\*\*([\s\S]+?)\*\*/.exec(src);
      if (m) { out += '<strong>' + renderInline(m[1], ctx) + '</strong>'; src = src.slice(m[0].length); continue; }
      m = /^__([\s\S]+?)__/.exec(src);
      if (m) { out += '<strong>' + renderInline(m[1], ctx) + '</strong>'; src = src.slice(m[0].length); continue; }

      // emphasis
      m = /^\*([^\s*][\s\S]*?)\*/.exec(src);
      if (m) { out += '<em>' + renderInline(m[1], ctx) + '</em>'; src = src.slice(m[0].length); continue; }
      if (src.charAt(0) === '_' && !/[A-Za-z0-9]$/.test(out)) {
        m = /^_([^\s_][\s\S]*?)_(?![A-Za-z0-9])/.exec(src);
        if (m) { out += '<em>' + renderInline(m[1], ctx) + '</em>'; src = src.slice(m[0].length); continue; }
      }

      // strikethrough
      m = /^~~([\s\S]+?)~~/.exec(src);
      if (m) { out += '<del>' + renderInline(m[1], ctx) + '</del>'; src = src.slice(m[0].length); continue; }

      // highlight (mark)
      m = /^==([\s\S]+?)==/.exec(src);
      if (m) { out += '<mark>' + renderInline(m[1], ctx) + '</mark>'; src = src.slice(m[0].length); continue; }

      // subscript
      m = /^~([^\s~][\s\S]*?)~/.exec(src);
      if (m) { out += '<sub>' + renderInline(m[1], ctx) + '</sub>'; src = src.slice(m[0].length); continue; }

      // superscript
      m = /^\^([^\s^][\s\S]*?)\^/.exec(src);
      if (m) { out += '<sup>' + renderInline(m[1], ctx) + '</sup>'; src = src.slice(m[0].length); continue; }

      // spoiler
      m = /^\|\|([\s\S]+?)\|\|/.exec(src);
      if (m) {
        out += '<span class="md-spoiler" tabindex="0" title="Click or focus to reveal">' + renderInline(m[1], ctx) + '</span>';
        src = src.slice(m[0].length); continue;
      }

      // bare URL autolink (GFM-style)
      m = /^(https?:\/\/[^\s<]+)/.exec(src);
      if (m) {
        var rawUrl = m[0].replace(/[.,;:!?'")\]]+$/, '');
        out += '<a href="' + escapeAttr(safeHref(rawUrl)) + '">' + escapeHtml(rawUrl) + '</a>';
        src = src.slice(rawUrl.length); continue;
      }

      // fallback: consume a run of plain characters
      m = /^[^\\`*_{}\[\]()!~^|=:<>\n]+/.exec(src);
      if (m) { out += escapeHtml(m[0]); src = src.slice(m[0].length); continue; }

      // single special character with no rule match
      out += escapeHtml(src[0]);
      src = src.slice(1);
    }
    return out;
  }

  function renderInlineMultiline(text, ctx) {
    // breaks:true (GFM-style) turns every newline into a hard break, not just
    // CommonMark's trailing-two-spaces / backslash-before-newline forms.
    var t = ctx.options.breaks
      ? String(text).replace(/\n/g, '')
      : String(text).replace(/ {2,}\n/g, '').replace(/\\\n/g, '').replace(/\n/g, ' ');
    return renderInline(t, ctx).split('').join('<br>\n');
  }

  // ----------------------------------------------------------------------
  // Block-level rendering
  // ----------------------------------------------------------------------

  function collectDefs(tokens, ctx) {
    tokens.forEach(function (t) {
      if (t.type === 'def') ctx.refs[t.tag] = { href: t.href, title: t.title };
      else if (t.type === 'footnoteDef') ctx.footnotes[t.id] = { text: t.text };
      else if (t.tokens) collectDefs(t.tokens, ctx);
      else if (t.items) t.items.forEach(function (it) { collectDefs(it.tokens, ctx); });
    });
  }

  function renderCodeBlock(lang, code, ctx) {
    var norm = normalizeLang(lang);
    var canHighlight = lang && KEYWORDS.hasOwnProperty(norm) && ctx.options.highlight;
    var body = canHighlight ? highlightCode(code, norm) : escapeHtml(code);
    var langLabel = lang ? '<span class="md-code-lang">' + escapeHtml(lang) + '</span>' : '<span class="md-code-lang">text</span>';
    return '<div class="md-codeblock">\n<div class="md-codeblock-bar">' + langLabel +
      '<button type="button" class="md-copy-btn" data-action="copy">Copy</button></div>\n<pre><code class="md-lang-' +
      escapeAttr(norm || 'text') + '">' + body + '</code></pre>\n</div>\n';
  }

  function renderTokens(tokens, ctx) {
    var html = '';
    for (var i = 0; i < tokens.length; i++) html += renderToken(tokens[i], ctx);
    return html;
  }

  function renderToken(t, ctx) {
    switch (t.type) {
      case 'heading': {
        var id = ctx.options.headerIds ? slugify(t.text, ctx.usedSlugs) : null;
        var headingHtml = renderInline(t.text, ctx);
        ctx.headings.push({ depth: t.depth, id: id, html: headingHtml });
        var idAttr = id ? ' id="' + escapeAttr(id) + '"' : '';
        var anchor = id ? ' <a class="md-anchor" href="#' + escapeAttr(id) + '" aria-hidden="true">#</a>' : '';
        return '<h' + t.depth + idAttr + '>' + headingHtml + anchor + '</h' + t.depth + '>\n';
      }
      case 'paragraph':
        return '<p>' + renderInlineMultiline(t.text, ctx) + '</p>\n';
      case 'code':
        return renderCodeBlock(t.lang, t.text, ctx);
      case 'blockquote': {
        if (t.callout && CALLOUTS[t.callout]) {
          var c = CALLOUTS[t.callout];
          return '<div class="md-callout md-callout-' + c.cls + '">\n<p class="md-callout-title">' +
            c.label + '</p>\n' + renderTokens(t.tokens, ctx) + '</div>\n';
        }
        return '<blockquote>\n' + renderTokens(t.tokens, ctx) + '</blockquote>\n';
      }
      case 'list': {
        var tag = t.ordered ? 'ol' : 'ul';
        var startAttr = t.ordered && t.start && t.start !== 1 ? ' start="' + t.start + '"' : '';
        var html = '<' + tag + startAttr + '>\n';
        t.items.forEach(function (item) {
          var cls = item.checked === null ? '' : ' class="md-task-item"';
          var inner = item.checked === null ? '' : '<input type="checkbox" disabled' + (item.checked ? ' checked' : '') + '> ';
          if (!t.loose && item.tokens.length && item.tokens.every(function (tk) { return tk.type === 'paragraph'; })) {
            inner += item.tokens.map(function (tk) { return renderInlineMultiline(tk.text, ctx); }).join('<br>\n');
          } else {
            inner += renderTokens(item.tokens, ctx);
          }
          html += '<li' + cls + '>' + inner + '</li>\n';
        });
        html += '</' + tag + '>\n';
        return html;
      }
      case 'table': {
        var th = '<table>\n<thead>\n<tr>\n';
        t.header.forEach(function (cell, idx) {
          var align = t.aligns[idx] ? ' style="text-align:' + t.aligns[idx] + '"' : '';
          th += '<th' + align + '>' + renderInline(cell, ctx) + '</th>\n';
        });
        th += '</tr>\n</thead>\n<tbody>\n';
        t.rows.forEach(function (row) {
          th += '<tr>\n';
          row.forEach(function (cell, idx) {
            var align = t.aligns[idx] ? ' style="text-align:' + t.aligns[idx] + '"' : '';
            th += '<td' + align + '>' + renderInline(cell || '', ctx) + '</td>\n';
          });
          th += '</tr>\n';
        });
        th += '</tbody>\n</table>\n';
        return th;
      }
      case 'hr':
        return '<hr>\n';
      case 'html':
        return (ctx.options.sanitize ? escapeHtml(t.text) : t.text) + '\n';
      case 'toc':
        return 'TOC\n';
      default:
        return '';
    }
  }

  function renderTOC(headings) {
    if (!headings.length) return '';
    var html = '<nav class="md-toc">\n<ul>\n';
    headings.forEach(function (h) {
      html += '<li class="md-toc-level-' + h.depth + '"><a href="#' + escapeAttr(h.id) + '">' + h.html + '</a></li>\n';
    });
    html += '</ul>\n</nav>\n';
    return html;
  }

  // ----------------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------------

  var defaults = {
    gfm: true,
    headerIds: true,
    highlight: true,
    sanitize: false,
    breaks: false
  };

  function parse(src, opts) {
    var options = {};
    for (var k in defaults) options[k] = defaults[k];
    if (opts) for (var k2 in opts) options[k2] = opts[k2];

    src = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    var lines = src.split('\n');
    var tokens = parseBlocks(lines);

    var ctx = {
      usedSlugs: {},
      headings: [],
      refs: {},
      footnotes: {},
      footnoteOrder: [],
      options: options
    };
    collectDefs(tokens, ctx);

    var body = renderTokens(tokens, ctx);

    if (ctx.footnoteOrder.length) {
      body += '<section class="md-footnotes">\n<hr>\n<ol>\n';
      ctx.footnoteOrder.forEach(function (id) {
        var def = ctx.footnotes[id];
        var text = def ? renderInlineMultiline(def.text, ctx) : '';
        body += '<li id="fn-' + escapeAttr(id) + '">' + text + ' <a href="#fnref-' + escapeAttr(id) + '" class="md-footnote-back">↩</a></li>\n';
      });
      body += '</ol>\n</section>\n';
    }

    if (body.indexOf('TOC') !== -1) {
      var tocHtml = renderTOC(ctx.headings);
      body = body.split('TOC\n').join(tocHtml).split('TOC').join(tocHtml);
    }

    return body.trim() + '\n';
  }

  function parseInline(src, opts) {
    var options = {};
    for (var k in defaults) options[k] = defaults[k];
    if (opts) for (var k2 in opts) options[k2] = opts[k2];
    var ctx = { usedSlugs: {}, headings: [], refs: {}, footnotes: {}, footnoteOrder: [], options: options };
    return renderInlineMultiline(String(src == null ? '' : src), ctx);
  }

  function remarker(src, opts) { return parse(src, opts); }
  remarker.parse = parse;
  remarker.parseInline = parseInline;
  remarker.setOptions = function (opts) {
    for (var k in opts) defaults[k] = opts[k];
    return remarker;
  };
  remarker.defaults = defaults;
  remarker.version = '1.0.0';

  return remarker;
}));
