/* ---------------------------------------------------------------
   kf0k terminal — typed-replay for ```terminal code blocks.

   Authoring syntax (inside the fenced code block):

     ```terminal
     # prompt: m@kali
     # cwd: ~/htb/active
     # replay: true           (optional; default true)
     # speed: 35              (optional ms per char; default 25)
     $ nmap -sC -sV 10.10.10.10
     ---
     Starting Nmap 7.94 at 2026-11-03
     PORT      STATE  SERVICE       VERSION
     88/tcp    open   kerberos-sec  Microsoft Kerberos
     ...
     ```

   Multiple commands supported — every line above the `---`
   starting with `$ ` is a typed command. Everything below is
   streamed output. You can also chain:

     $ cmd 1
     $ cmd 2
     ---
     output of cmd 1 and 2 mixed is fine, this is a notebook
--------------------------------------------------------------- */

(function () {
  "use strict";

  const SELECTOR = "pre > code.language-terminal";

  function parseBlock(raw) {
    const lines = raw.replace(/\r/g, "").split("\n");
    const cfg = { prompt: "m@kali", cwd: "~", replay: true, speed: 25 };
    const commands = [];
    const output = [];
    let state = "cmd";

    for (const line of lines) {
      const m = line.match(/^#\s*(prompt|cwd|replay|speed)\s*:\s*(.+)\s*$/i);
      if (m) {
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === "replay") cfg.replay = /^(true|yes|1|on)$/i.test(v);
        else if (k === "speed") cfg.speed = Math.max(5, parseInt(v, 10) || 25);
        else cfg[k] = v;
        continue;
      }
      if (state === "cmd" && /^---+\s*$/.test(line)) { state = "out"; continue; }
      if (state === "cmd") {
        const cm = line.match(/^\$\s(.*)$/);
        if (cm) commands.push(cm[1]);
        else if (line.trim() !== "") commands.push("# " + line);  // continuation / comment
      } else {
        output.push(line);
      }
    }
    return { cfg, commands, output };
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** Lightweight colorizer for output lines — picks up common Kali patterns. */
  function colorize(line) {
    const s = esc(line);
    // nmap port lines: "88/tcp    open   kerberos-sec  ..."
    let m = s.match(/^(\s*\d+\/(?:tcp|udp))(\s+)(open|closed|filtered)(\s+)(\S+)(\s+)(.*)$/);
    if (m) {
      return `<span class="k-magenta">${m[1]}</span>${m[2]}` +
             `<span class="${m[3] === "open" ? "k-green" : "k-dim"}">${m[3]}</span>` +
             `${m[4]}<span class="k-blue">${m[5]}</span>${m[6]}${m[7]}`;
    }
    // Impacket-style [+] success
    if (/^\s*\[\+\]/.test(s)) return `<span class="k-green">${s}</span>`;
    if (/^\s*\[-\]/.test(s)) return `<span class="k-red">${s}</span>`;
    if (/^\s*\[\*\]/.test(s)) return `<span class="k-blue">${s}</span>`;
    if (/^\s*\[!\]/.test(s)) return `<span class="k-yellow">${s}</span>`;
    // nmap header
    if (/^(PORT|STATE|SERVICE|VERSION|Starting Nmap|Nmap scan report|Host is up)/.test(s)) {
      return `<span class="k-yellow">${s}</span>`;
    }
    // generic "key: value"
    const kv = s.match(/^(\s*)([A-Z][A-Za-z0-9_ -]+):(\s)(.*)$/);
    if (kv) return `${kv[1]}<span class="k-blue">${kv[2]}:</span>${kv[3]}${kv[4]}`;
    return s;
  }

  function promptLine(cfg) {
    const user = esc(cfg.prompt);
    const cwd = esc(cfg.cwd);
    return `<span class="kf-term__prompt">┌──(${user}㉿kali)-[${cwd}]</span>\n` +
           `<span class="kf-term__prompt">└─$</span> `;
  }

  function mount(codeEl) {
    const raw = codeEl.textContent;
    const parsed = parseBlock(raw);
    const pre = codeEl.closest("pre");
    if (!pre) return;

    const title = `${parsed.cfg.prompt}@kali: ${parsed.cfg.cwd}`;
    const wrap = document.createElement("div");
    wrap.className = "kf-term";
    wrap.innerHTML =
      `<div class="kf-term__bar">
         <div class="kf-term__dots">
           <span class="kf-term__dot kf-term__dot--r"></span>
           <span class="kf-term__dot kf-term__dot--y"></span>
           <span class="kf-term__dot kf-term__dot--g"></span>
           <span class="kf-term__title">${esc(title)}</span>
         </div>
         <div class="kf-term__ctrls">
           ${parsed.cfg.replay ? '<button class="kf-term__btn kf-term__btn--primary" data-act="replay">▶ REPLAY</button>' : ''}
           <button class="kf-term__btn" data-act="skip">⏭ SKIP</button>
           <button class="kf-term__btn" data-act="copy">COPY</button>
         </div>
       </div>
       <pre class="kf-term__body"></pre>
       ${parsed.cfg.replay ? `
       <div class="kf-term__scrub">
         <span class="kf-term__time">00:00</span>
         <div class="kf-term__bar-outer"><div class="kf-term__bar-inner"></div><div class="kf-term__bar-knob"></div></div>
         <span class="kf-term__speed" data-act="speed">1×</span>
       </div>` : ''}`;

    pre.replaceWith(wrap);
    const body = wrap.querySelector(".kf-term__body");
    const barInner = wrap.querySelector(".kf-term__bar-inner");
    const barKnob = wrap.querySelector(".kf-term__bar-knob");
    const timeEl = wrap.querySelector(".kf-term__time");

    // State machine
    let timer = null;
    let speedMult = 1;
    let totalChars = parsed.commands.reduce((n, c) => n + c.length + 4, 0)   // prompt + cmd + enter
                   + parsed.output.join("\n").length;
    let elapsedChars = 0;

    function finalRender() {
      let html = "";
      for (const cmd of parsed.commands) {
        html += promptLine(parsed.cfg) + esc(cmd) + "\n";
      }
      if (parsed.output.length) html += "\n";
      html += `<span class="kf-term__out">${parsed.output.map(colorize).join("\n")}</span>`;
      body.innerHTML = html;
      if (barInner) { barInner.style.width = "100%"; barKnob.style.left = "100%"; }
      if (timeEl) timeEl.textContent = fmt(totalChars * (parsed.cfg.speed / 1000) / speedMult);
    }

    function fmt(s) {
      s = Math.max(0, Math.round(s));
      const m = Math.floor(s / 60), r = s % 60;
      return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    }

    function animate() {
      stop();
      body.innerHTML = "";
      elapsedChars = 0;
      let out = "";
      let ci = 0, pos = 0, phase = "typing"; // typing | enter | out

      const stepMs = Math.max(5, parsed.cfg.speed / speedMult);

      const tick = () => {
        if (phase === "typing") {
          if (ci >= parsed.commands.length) { phase = "out"; return next(); }
          if (pos === 0) out += promptLine(parsed.cfg);
          const cmd = parsed.commands[ci];
          if (pos < cmd.length) {
            out += esc(cmd[pos]);
            pos++; elapsedChars++;
          } else {
            out += '<span class="kf-term__caret"></span>\n';
            body.innerHTML = out + '<span class="kf-term__caret"></span>';
            // small newline pause then advance
            setTimeout(() => {
              out = out.replace('<span class="kf-term__caret"></span>\n', "\n");
              ci++; pos = 0;
              next();
            }, 220 / speedMult);
            return;
          }
        } else if (phase === "out") {
          const text = parsed.output.join("\n");
          if (pos < text.length) {
            // stream a chunk per tick for speed
            const chunk = Math.min(3, text.length - pos);
            pos += chunk; elapsedChars += chunk;
          } else {
            phase = "done";
          }
          const outText = parsed.output.map(colorize).join("\n").slice(0, pos);
          const commandsHtml = parsed.commands.map(c => promptLine(parsed.cfg) + esc(c)).join("\n") + "\n";
          out = commandsHtml + '\n<span class="kf-term__out">' + outText + "</span>";
        }
        render();
        if (phase === "done") { stop(); finalRender(); return; }
        next();
      };
      const render = () => {
        body.innerHTML = out + (phase === "typing" ? '<span class="kf-term__caret"></span>' : '');
        body.scrollTop = body.scrollHeight;
        if (barInner) {
          const pct = Math.min(1, elapsedChars / totalChars);
          barInner.style.width = (pct * 100) + "%";
          barKnob.style.left = (pct * 100) + "%";
          if (timeEl) timeEl.textContent = fmt((elapsedChars * parsed.cfg.speed / 1000) / speedMult);
        }
      };
      const next = () => { timer = setTimeout(tick, stepMs); };
      next();
    }

    function stop() { if (timer) { clearTimeout(timer); timer = null; } }

    // Controls
    wrap.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "replay") animate();
      if (act === "skip") { stop(); finalRender(); }
      if (act === "copy") {
        const text = parsed.commands.join("\n");
        navigator.clipboard?.writeText(text);
        const btn = e.target.closest("[data-act=copy]");
        btn.textContent = "COPIED"; setTimeout(() => btn.textContent = "COPY", 1200);
      }
      if (act === "speed") {
        speedMult = speedMult === 1 ? 2 : speedMult === 2 ? 4 : 1;
        e.target.textContent = speedMult + "×";
      }
    });

    // Autoplay once when scrolled into view, if replay enabled; else render final.
    if (parsed.cfg.replay && "IntersectionObserver" in window) {
      const io = new IntersectionObserver((ents) => {
        for (const ent of ents) {
          if (ent.isIntersecting) { io.disconnect(); animate(); return; }
        }
      }, { threshold: 0.35 });
      io.observe(wrap);
    } else {
      finalRender();
    }
  }

  function boot() {
    document.querySelectorAll(SELECTOR).forEach(mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
