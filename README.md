# kf0k blog

Source for <https://kf0k.github.io/blog/> — Jekyll + the
[Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy) theme, with a
typed-replay terminal component for code blocks.

## Push this to GitHub (browser only, no CLI)

1. Open <https://github.dev/kf0k/blog> (or press `.` on the repo page).
2. In the file tree on the left, delete every existing file in the
   repo. The current `gh-pages` branch holds only the old built MkDocs
   output — none of it is needed any more.
3. Drag this whole folder into the file tree. Everything commits to
   the current branch.
4. Open **Source Control** (Ctrl+Shift+G). Stage all, commit with a
   message like `Rebuild on Jekyll + Chirpy`, then click **Sync**.

### Switch Pages to build from Actions

The deploy workflow in `.github/workflows/pages-deploy.yml` builds
Jekyll and publishes it. GitHub Pages needs to know to use it.

1. In your repo on github.com → **Settings** → **Pages**.
2. **Source**: *GitHub Actions*.
3. If a `gh-pages` branch is still present, it is ignored; delete it
   when you are satisfied the Actions build succeeded.

### Default branch

Chirpy ships workflows that expect the source on `main`. If this repo's
default branch is still `gh-pages`, change it:

1. **Settings** → **Branches** → rename `gh-pages` to `main`, or
   create a new `main` from the files you just committed and set it
   default.
2. The workflow fires on pushes to `main`.

## Writing posts

Drop a file into `_posts/` named `YYYY-MM-DD-slug.md` with front-matter:

```yaml
---
title: "HTB: Flight"
date: 2023-02-04 10:00:00 +0400
categories: [Writeups, HTB]
tags: [active-directory, lfi, kerberos, aspx, seimpersonate]
difficulty: Hard
os: Windows
ip: 10.10.11.187
description: "LFI → Responder → password spray → ASPX webshell → SeImpersonate."
---
```

The two categories matter: a writeup carries `[Writeups, HTB]`, an AD
post carries `[AD]`, a regular post carries `[Posts]`. The Writeups tab
builds its listing from the `writeups` category (lower-cased by Jekyll).

### Typed-replay terminal

Any post that uses the Ubuntu-style terminal starts with:

```liquid
{% raw %}{% include term-boot.html %}{% endraw %}
```

anywhere near the top. Then use fenced code blocks with language
`terminal`:

~~~markdown
```terminal
# prompt: m
# cwd: ~/htb/active
# replay: true
# speed: 25
$ nmap -sC -sV 10.10.10.10
---
Starting Nmap 7.94 ...
PORT   STATE  SERVICE
88/tcp open   kerberos-sec
```
~~~

Rules:

- `# prompt:` and `# cwd:` set the Kali-style prompt line.
- `# replay: false` renders static (no animation).
- `# speed: 25` is ms per character.
- Lines starting with `$ ` are typed as commands.
- `---` on its own line separates commands from streamed output.
- Everything below `---` is streamed as output; `[+]`, `[-]`, `[*]`,
  `[!]`, nmap port lines, and `KEY:` headers get coloured automatically.

For plain non-animated code use the usual fences: `bash`, `powershell`,
`console`, etc.

## Local preview (optional)

If you want to preview without pushing:

```bash
bundle install
bundle exec jekyll serve --baseurl /blog
# → http://127.0.0.1:4000/blog/
```

## Credits

Theme: [Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy) by
Cotes Chung, MIT.
