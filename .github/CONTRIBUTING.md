## 🤝 Contributing Guide

Thank you for your interest in contributing to **Snapdom**! Your help makes this project better for everyone. Below you’ll find some guidelines to get started.

---

### 📝 **Issues**

* If you find a **bug**, please [open an issue](https://github.com/zumerlab/snapdom/issues/new) and provide as much detail as possible (steps to reproduce, expected behavior, actual behavior, etc.).
* If you have a **feature request** or an idea for improvement:

  * You can [open an issue](https://github.com/zumerlab/snapdom/issues/new).
  * Or, start a [discussion](https://github.com/zumerlab/snapdom/discussions/new) to explore the idea with the community.

Even small things matter — if you spot a **typo** in the code, docs, or comments, please let us know or submit a fix!

---

### 💡 **Examples**

If you build something cool using **Snapdom**, we’d love to see it! Consider starting a **discussion** to share ideas and get feedback.

---

### 💬 **Discussions**

You’re welcome to use [GitHub Discussions](https://github.com/zumerlab/snapdom/discussions) for:

* Asking questions.
* Sharing feedback or ideas.
* Connecting with other users and contributors.

Let’s keep the tone friendly and constructive!

---

### 🎯 **What we look at**

Every change is judged on three things:

* **Speed.** SnapDOM is fast and has to stay fast. If you touch the capture path, run `npm run test:benchmark` and share the numbers before and after.
* **Fidelity.** The capture should match what the browser renders. A fix for one case can't break another.
* **Architecture.** Changes follow the existing structure, described in [ARCHITECTURE.md](https://github.com/zumerlab/snapdom/blob/main/ARCHITECTURE.md). If it's a feature outside the core, it's probably a plugin (see [CONTRIBUTING_PLUGINS.md](https://github.com/zumerlab/snapdom/blob/main/CONTRIBUTING_PLUGINS.md)).

---

### 🤖 **Using AI**

AI-assisted contributions are welcome. Before you start, have your agent read [ARCHITECTURE.md](https://github.com/zumerlab/snapdom/blob/main/ARCHITECTURE.md) and [llms.txt](https://snapdom.dev/llms.txt), so it works with the current design and the real API.

They meet the same three principles, plus:

* Tests that cover the change.
* A demo that shows it working: a small HTML page, a before/after capture or a short video.
* You understand what you're sending and can answer questions about it.

Tell us in the PR that you used AI.

---

### 🚀 **Pull Requests (PRs)**

* Before starting, it’s a good idea to **discuss large changes** in an issue or discussion.
* Fork the repo, create a branch (e.g. `fix-xyz`, `feature-abc`), and submit your PR.
* Please make sure:

  * Your code follows the project’s style (we can help review).
  * You add tests or documentation if relevant.
  * You link the related issue (if any) in the PR description.

All contributions are reviewed and merged after approval. Don’t worry if you’re new — we’re happy to help!

---

### ⚡ Quick links

* [Open an issue](https://github.com/zumerlab/snapdom/issues/new)
* [Start a discussion](https://github.com/zumerlab/snapdom/discussions/new)
* [Check open PRs](https://github.com/zumerlab/snapdom/pulls)
