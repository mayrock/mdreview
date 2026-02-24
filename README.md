# MDReview

**Preview-first Markdown reviews for GitHub pull requests.**

MDReview is a Chrome extension POC that lets you **review rendered Markdown** in GitHub PRs and quickly jump to the correct source lines to leave native review comments.

> GitHub review comments are line-anchored.  
> Markdown is reviewed visually.  
> MDReview bridges that gap.

---

## Problem

Reviewing Markdown (`.md`, `.mdx`) in GitHub pull requests is awkward:

- Reviewers read **rendered Markdown**
- But comments must be added in **source / diff view**
- Mapping “this paragraph / table / section” back to lines is slow and error-prone

This friction is especially painful for:
- docs
- READMEs
- ADRs
- specs and RFCs

---

## What MDReview Does

MDReview adds a **preview-first review workflow** on the **PR → Files changed** page:

1. Extracts the Markdown from the PR diff (optimized for new files)
2. Renders a **block-level preview** (headings, paragraphs, tables, code fences)
3. Lets you click **Comment** on any rendered block
4. Jumps you to the correct source line in the diff
5. You leave a **native GitHub inline comment**
6. One click takes you **back to the preview**

No new comment system.  
No custom storage.  
Fully compatible with GitHub reviews.

---

## Key Features

- ✅ Preview rendered Markdown inside PRs
- ✅ Block-level mapping (section / paragraph / table / code block)
- ✅ One-click jump from preview → diff
- ✅ One-click return to preview
- ✅ Uses GitHub’s native inline comments
- ✅ Works with GitHub’s **new “Files changed” experience**

---

## Non-Goals (By Design)

MDReview intentionally does **not** try to:

- ❌ Create word- or character-level anchors  
- ❌ Replace GitHub’s comment system  
- ❌ Post comments via API (no OAuth / tokens)  
- ❌ Act like Google Docs  

GitHub review comments are line-based. MDReview works *with* that model, not against it.

---

## Current Scope (POC)

This proof of concept is optimized for:

- **New Markdown files** in PRs (mostly-added diffs)
- `.md`, `.mdx`, `.markdown`

It uses **heuristics**, not a full AST source map.

---

## Installation (Chrome)

1. Download and unzip the extension
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the unzipped `mdreview` folder

Then open any PR:

```
https://github.com/<org>/<repo>/pull/<number>/files
```

---

## Usage

1. Go to **PR → Files changed**
2. Scroll to (or near) a Markdown file
3. Click the **MDReview** button (top-right)
4. Review the rendered preview in the side drawer
5. Click **Comment** on any block
6. Add a native GitHub inline comment
7. Click **← Back to preview** to continue reviewing

---

## How It Works (High Level)

- Detects Markdown file diffs in the Files changed view
- Extracts added lines from the diff
- Groups lines into logical blocks (headings, paragraphs, tables, code fences)
- Renders blocks into a preview panel
- Maps each block to its starting line number
- Navigates the user to GitHub’s own inline comment UI

No GitHub APIs are used.

---

## Known Limitations

- Block boundaries are heuristic
- Inline word-level anchors are not supported (GitHub limitation)
- Modified (non-new) Markdown files are less robustly handled
- GitHub DOM changes may require selector updates

This is expected for a POC.

---

## Why This Exists

Markdown is **content**, not code.  
But GitHub PR reviews treat it like code.

MDReview makes Markdown reviews feel natural again—without breaking GitHub’s review model.

---

## Roadmap Ideas

- Better handling of edited (non-new) Markdown files
- Quote selected text into the comment box
- More robust block detection (AST-backed)
- Support for additional rendered formats (e.g. AsciiDoc)

---

## License

MIT

---

## Status

🧪 Proof of Concept  
Feedback, issues, and experiments welcome.
