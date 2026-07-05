# BossSay v4.0.0 -- AI Agentic Job Application Assistant

> A Chrome extension that uses an AI agent with ReAct reasoning, self-evaluation, and adaptive learning to generate personalized, high-quality first messages on Boss Zhipin (Boss直聘).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Agentic Pipeline](#3-agentic-pipeline)
4. [Memory System](#4-memory-system)
5. [Module Reference](#5-module-reference)
6. [Data Flow](#6-data-flow)
7. [Configuration](#7-configuration)
8. [Development](#8-development)

---

## 1. Overview

### What Is BossSay

BossSay is a Chrome extension (Manifest V3) that helps job seekers write effective first-contact messages on Boss Zhipin. Instead of sending generic greetings like "Hi, I'm interested in this position", BossSay uses an AI agent to analyze each job posting, match it against the user's resume, and generate a personalized message that HR is more likely to reply to.

### Why It Exists

HR on Boss Zhipin receives hundreds of identical greetings daily. The problem is not speed -- it is quality. BossSay focuses on message quality by combining:

- **Resume-to-JD matching**: The AI reads both the job description and the candidate's background.
- **Multi-step reasoning**: A ReAct-style agent pipeline analyzes, evaluates, generates, and self-reviews each message.
- **Adaptive learning**: The system tracks which messages get replies and optimizes over time.

### Key Design Principles

1. **No fabrication** -- The AI is strictly forbidden from inventing resume details. This is a hard rule enforced in every prompt.
2. **Three-part structure** -- Every message follows: skill match, availability, closing question.
3. **Safety first** -- The extension never auto-sends messages. The user always reviews and manually sends.
4. **Local-first data** -- All data stays in `chrome.storage.local`. Nothing is uploaded to external servers.

---

## 2. Architecture Overview

### System Diagram

```
+------------------------------------------------------------------+
|                       Chrome/Edge Browser                         |
|                                                                   |
|  +-----------------------------+                                  |
|  |         Popup (UI)          |                                  |
|  |  Tabs: Generate | Profile   |                                  |
|  |  Settings | More            |                                  |
|  |                             |                                  |
|  |  - BossAgent.run()          |   chrome.runtime.sendMessage     |
|  |  - BossEvaluate.record()    +-------------------------+       |
|  |  - BossEvaluate.getStats()  |                         |       |
|  +-----------------------------+                         |       |
|                                                          |       |
|  +-----------------------------+   chrome.tabs.sendMsg   |       |
|  |     Content Script          |<------------------------+       |
|  |  (content/content.js)       |                                  |
|  |                             |                                  |
|  |  - Page detection           |   Injects into zhipin.com       |
|  |  - Job card extraction      |                                  |
|  |  - Message injection        |                                  |
|  |  - Floating BossSay button  |                                  |
|  +-----------------------------+                                  |
|                                                                   |
|  +-----------------------------+   chrome.runtime.sendMessage     |
|  |     Service Worker          |<---------------------------------+
|  |  (background/service-       |
|  |   worker.js)                |
|  |                             |   fetch (CORS-free)
|  |  - Storage read/write       +---------------------> AI API
|  |  - API proxy (CORS bypass)  |                      (OpenAI-compatible)
|  |  - Export/Import            |
|  |  - Style config             |
|  +-----------------------------+                                  |
|                                                                   |
|  +-----------------------------+                                  |
|  |     Agent Libraries         |                                  |
|  |                             |                                  |
|  |  lib/agent.js    - ReAct    |  Called by Popup directly        |
|  |  lib/evaluate.js - Stats    |                                  |
|  |  lib/pdf-extractor.js       |                                  |
|  +-----------------------------+                                  |
+------------------------------------------------------------------+
```

### Six Core Modules

| Module | File | Role |
|--------|------|------|
| **BossAgent** | `lib/agent.js` | ReAct engine -- multi-step reasoning chain for message generation |
| **BossEvaluate** | `lib/evaluate.js` | Analytics -- tracks message outcomes, computes reply rates, A/B testing |
| **PDF Extractor** | `lib/pdf-extractor.js` | Resume parsing -- text extraction + AI OCR for scanned PDFs |
| **Service Worker** | `background/service-worker.js` | Background service -- storage, API proxy, export/import |
| **Content Script** | `content/content.js` | Page interaction -- DOM extraction, message injection, floating button |
| **Popup** | `popup/popup.js` | User interface -- four tabs, agent invocation, stats dashboard |

### Communication Patterns

```
Popup  --[chrome.runtime.sendMessage]--> Service Worker (storage, API proxy)
Popup  --[chrome.tabs.sendMessage]-----> Content Script (extract, inject)
Popup  --[direct call]-----------------> BossAgent / BossEvaluate / PDFExtractor
Content Script --[chrome.runtime.sendMessage]--> Service Worker (open popup)
```

---

## 3. Agentic Pipeline

The core of BossSay is a multi-step reasoning pipeline in `BossAgent.run()`. It mimics how a thoughtful human would write a job application message: analyze, match, plan, write, review, fix.

### Pipeline Steps

```
Step 1: Analyze JD + Match Resume    (1 API call, combined)
  |
  v
Step 2: Evaluate Fit                 (local computation)
  |
  v
Step 3: Generate Draft + Self-Review  (1 API call, combined)
  |
  v
Step 4: Revise (if review found issues) (1 API call, conditional)
  |
  v
Final: Return message + full trace
```

### Step 1: Analyze JD and Match Resume

A single API call analyzes the job description and matches it against the candidate's resume. The prompt asks the AI to return structured JSON containing:

- `analysis`: core requirements, nice-to-haves, role type, seniority, key skills
- `match`: matched skills, matched experience, gaps, strengths, match ratio (0-1)

This step combines two operations into one API call to reduce latency and token usage.

### Step 2: Evaluate Fit (Local)

No API call. The agent computes a match strategy based on the match ratio:

| Match Ratio | Strategy | Emphasis |
|-------------|----------|----------|
| >= 70% | High match: showcase matched skills confidently | Skills |
| 40-69% | Medium match: highlight transferable skills and learning ability | Potential |
| < 40% | Low match: emphasize general abilities and strong interest | Attitude |

### Step 3: Generate Draft and Self-Review

A single API call generates the message AND performs self-review. The prompt instructs the AI to:

1. Write an 80-150 character message following the three-part structure
2. Self-check for fabrication, length, hollow phrases, availability info, and closing question
3. Return both the message and a review object with issues, suggestions, and a score

### Step 4: Revise (Conditional)

If the self-review found issues (fabrication detected, too long, missing elements), the agent makes a corrective API call. It passes the original message and the list of issues, asking the AI to fix only the problems without major changes.

### Trace Output

Every step produces a trace entry. The full trace is returned alongside the final message and displayed in the UI as a reasoning chain panel. This gives users transparency into how the AI arrived at the message.

```
trace: [
  { step: "analyze_jd", result: { coreRequirements: [...], keySkills: [...] } },
  { step: "match_resume", result: { matchedSkills: [...], matchRatio: 0.75 } },
  { step: "evaluate_fit", result: { score: 75, strategy: "..." } },
  { step: "generate_draft", success: true },
  { step: "review", result: { issues: [], score: 85, hasFabrication: false } }
]
```

### Timeout Protection

Each API call is wrapped in a 30-second timeout. If the AI does not respond in time, the step fails gracefully and the pipeline continues or returns an error.

---

## 4. Memory System

BossSay v4.0.0 introduces a structured memory system for learning from past interactions.

### Memory Types

| Type | Storage Key | Scope | Purpose |
|------|-------------|-------|---------|
| **STM (Short-Term Memory)** | In-session state | Current session | Tracks the current generation context, active job, pending actions |
| **LTM (Long-Term Memory)** | `bossSay_history` | Persistent | Stores all generation records with sent/replied status |
| **Episodic Memory** | `bossSay_history` entries | Per-event | Each record captures a specific generation event: job title, company, style, message, match score, trace, timestamps |
| **Semantic Memory** | `bossSay_stylePrompts`, `bossSay_profile` | Persistent | Accumulated knowledge about what works: style configurations, profile refinements |

### Learning Pipeline

```
User generates message
       |
       v
BossEvaluate.recordGeneration()  -->  Saves to bossSay_history
       |
       v
User marks "sent"                -->  BossEvaluate.markSent(id)
       |
       v
User marks "replied"             -->  BossEvaluate.markReplied(id, true/false)
       |
       v
BossEvaluate.getStats()          -->  Aggregates reply rates by style & match score
       |
       v
BossEvaluate.getBestStyle()      -->  Recommends highest-performing style
```

### Consolidation Process

The learning pipeline consolidates data in two ways:

1. **Style effectiveness**: By tracking reply rates per style (professional, friendly, humor, concise), the system can recommend which style works best for the user.
2. **Match score correlation**: By grouping outcomes into high/mid/low match buckets, users can see whether targeting high-match jobs yields better results.

History is capped at 100 records to prevent unbounded storage growth. Older records are dropped when new ones are added.

---

## 5. Module Reference

### 5.1 agent.js -- BossAgent

The ReAct reasoning engine. All methods are on the `BossAgent` object.

**Primary API:**

```javascript
BossAgent.run({
  profile,      // { resume, experience, skills, education, availableDate, ... }
  jobInfo,      // { title, company, salary, location, jd }
  style,        // "professional" | "friendly" | "humor" | "concise"
  callAPI,      // async (messages) => string  -- AI API call function
  stylePrompts, // { [key]: { name, prompt, instruction } }  -- custom styles
  onProgress,   // (stepName, detail) => void  -- progress callback
})
// Returns: { message: string, trace: Array, matchScore: number }
```

**Internal Methods:**

| Method | Description |
|--------|-------------|
| `analyzeAndMatch(profile, jobInfo, callAPI)` | Step 1: Combined JD analysis + resume matching via single API call |
| `evaluateFit(matchResult)` | Step 2: Local match score and strategy computation |
| `generateAndReview(profile, jobInfo, jdAnalysis, matchResult, evaluation, style, callAPI, stylePrompts)` | Step 3: Combined message generation + self-review via single API call |
| `reviseMessage(message, issues, profile, jobInfo, callAPI)` | Step 4: Corrective revision based on review issues |
| `_withTimeout(promiseFn, timeoutMs)` | Wraps a promise with a 30s timeout |
| `_parseJSON(text)` | Robust JSON parser: strips code fences, tries direct parse, falls back to regex, handles trailing commas |

**Events / Progress Callbacks:**

| Step Name | Description |
|-----------|-------------|
| `analyze_jd` | "Analyzing job + matching resume..." |
| `evaluate_fit` | "Evaluating match score..." |
| `generate_draft` | "Generating message + reviewing..." |
| `revise` | "Fixing message issues..." |

**Style System:**

Default styles are built-in. User-customized styles from `bossSay_stylePrompts` override defaults when an `instruction` field is present.

| Style Key | Default Instruction |
|-----------|-------------------|
| `professional` | Professional, concise, confident tone. Use data and results. |
| `friendly` | Warm, sincere, enthusiastic tone. Show genuine interest. |
| `humor` | Light, humorous, personality-driven tone. Maintain professional baseline. |
| `concise` | Max 120 characters. Highest information density. No filler. |

### 5.2 evaluate.js -- BossEvaluate

Analytics and feedback module. All methods are on the `BossEvaluate` object.

**Recording API:**

```javascript
// Record a message generation
BossEvaluate.recordGeneration({
  jobTitle,     // string
  company,      // string
  style,        // string
  message,      // string
  matchScore,   // number (0-100)
  trace,        // Array
  userEdited,   // boolean
})
// Returns: recordId (string) or null

// Mark a message as sent
BossEvaluate.markSent(recordId)

// Mark whether HR replied
BossEvaluate.markReplied(recordId, replied)  // replied: true | false | null
```

**Analytics API:**

```javascript
// Get aggregate statistics
BossEvaluate.getStats()
// Returns: {
//   total: number,
//   sent: number,
//   replied: number,
//   replyRate: number,      // percentage
//   byStyle: {
//     [style]: { sent, replied, replyRate }
//   },
//   byMatchScore: {
//     high: { sent, replied },  // >= 70%
//     mid:  { sent, replied },  // 40-69%
//     low:  { sent, replied },  // < 40%
//   }
// }

// Get the style with the highest reply rate (minimum 3 sends)
BossEvaluate.getBestStyle()
// Returns: { style: string | null, replyRate: number }
```

**A/B Testing Support:**

The `byStyle` breakdown in `getStats()` enables manual A/B testing. Users can try different styles for different jobs and compare reply rates in the stats panel. `getBestStyle()` automatically identifies the winning style.

### 5.3 service-worker.js -- Service Worker

Background service handling storage, API proxying, and data management.

**Message Types:**

| Type | Direction | Purpose |
|------|-----------|---------|
| `OPEN_POPUP` | Content -> SW | Request to open the popup (requires user gesture) |
| `GET_API_CONFIG` | Popup -> SW | Read API configuration from storage |
| `SAVE_API_CONFIG` | Popup -> SW | Write API configuration to storage |
| `GET_PROFILE` | Popup -> SW | Read user profile from storage |
| `SAVE_PROFILE` | Popup -> SW | Write user profile to storage |
| `GET_STYLE_PROMPTS` | Popup -> SW | Read custom style configurations |
| `SAVE_STYLE_PROMPTS` | Popup -> SW | Write custom style configurations |
| `EXPORT_SETTINGS` | Popup -> SW | Export all settings as JSON (with optional API key/resume exclusion) |
| `IMPORT_SETTINGS` | Popup -> SW | Import settings from JSON file |
| `GET_HISTORY` | Popup -> SW | Read generation history |
| `CLEAR_HISTORY` | Popup -> SW | Clear all history records |
| `AI_CHAT_COMPLETIONS` | Popup -> SW | Proxy an AI API call (CORS bypass) |

**API Proxy:**

The `AI_CHAT_COMPLETIONS` handler is critical. Chrome extension popups cannot make cross-origin fetch requests reliably. The service worker's fetch is not subject to page CORS restrictions because it runs in the extension's background context with `host_permissions` authorization.

```
Popup  --[AI_CHAT_COMPLETIONS]--> Service Worker --[fetch]--> AI API
                                                            (OpenAI-compatible)
```

The proxy also handles reasoning model compatibility: if `choices[0].message.content` is empty, it falls back to `reasoning_content` (for models like DeepSeek).

**Rate Limiting / Caching:**

The service worker does not implement explicit rate limiting or caching in v4.0.0. Rate limiting is implicit through the agent pipeline (max 3-4 API calls per generation). Caching is not implemented since each generation is context-dependent.

**Data Storage:**

All data uses `chrome.storage.local` with the `bossSay_` prefix:

| Key | Content |
|-----|---------|
| `bossSay_apiConfig` | `{ baseUrl, apiKey, modelName }` |
| `bossSay_profile` | `{ bossSay_resume, bossSay_experience, bossSay_skills, bossSay_education, bossSay_availableDate, bossSay_internshipDuration, bossSay_jobType, bossSay_wantFulltime, bossSay_github, bossSay_portfolio, bossSay_selfIntro }` |
| `bossSay_history` | Array of generation records (max 100) |
| `bossSay_stylePrompts` | Custom style configurations |
| `bossSay_stylePreference` | Last selected style key |

### 5.4 content.js -- Content Script

Injected into Boss Zhipin pages. Handles page detection, data extraction, and message injection.

**Page Detection:**

```javascript
getPageType()
// Returns: "search" | "detail" | "chat" | "other"
//
// search: /geek/jobs  -- job listing page with cards
// detail: /job_detail/ or /web/geek/job  -- single job page
// chat:   /chat  -- conversation page
// other:  everything else
```

**Extraction -- Search Page:**

`extractFromSearchPage()` iterates over all `.job-card-box` elements and extracts:

- Job title, company name, salary, location
- Experience and education tags
- Skips cards marked "已沟通" (already contacted)
- Returns an array of job objects

**Extraction -- Detail Page:**

`extractFromDetailPage()` extracts metadata from the DOM. JD extraction attempts to find text blocks matching job description patterns (`岗位职责`, `任职要求`, etc.), but this is unreliable due to Boss Zhipin's CSS obfuscation on detail pages. Users may need to manually paste the JD.

**Message Injection:**

`injectMessageToInput(message, retries, interval)` tries multiple selectors to find the chat input field, then sets the value using the native property descriptor (to bypass React's synthetic event system). It retries up to 10 times with 500ms intervals to handle dynamically loaded inputs.

**Floating Button:**

On search and detail pages, a fixed-position "BossSay" button is injected in the bottom-right corner. Clicking it sends `OPEN_POPUP` to the service worker.

**URL Change Detection:**

A `MutationObserver` watches for URL changes (Boss Zhipin is a SPA) and re-initializes the floating button when the page navigates.

### 5.5 popup.js -- Popup UI

The main user interface, organized into four tabs.

**Tab 1 -- Generate:**

- Page detection: checks if the current tab is on zhipin.com
- Scan button: sends `EXTRACT_JOB_INFO` to content script, displays results
- Editable fields: job title, company, salary, location, JD (user can override scanned values)
- Style selector: professional / friendly / humor / concise
- Generate button: invokes `BossAgent.run()` with full pipeline
- Output area: editable message, match score display, reasoning trace panel
- Fill button: sends message to content script for injection
- Copy button: copies message to clipboard

**Tab 2 -- Profile:**

- PDF upload area (drag-and-drop + file picker)
- PDF processing pipeline:
  1. Read file as ArrayBuffer
  2. Extract text via `PDFExtractor.extractText()`
  3. If text is empty/short, treat as scanned PDF: render pages as images, send to AI for OCR
  4. Send extracted text to AI for structured parsing (JSON output)
  5. Auto-fill form fields from parsed JSON
- Manual form fields: resume summary, experience, skills, education, availability, internship duration, job type, fulltime preference, GitHub, portfolio, self-introduction

**Tab 3 -- Settings:**

- API configuration: URL, API key, model name
- Preset buttons for common providers
- Connection test: sends a test message through the service worker proxy
- Style editor: customize the instruction text for each style

**Tab 4 -- More:**

- Statistics panel: total records, sent count, reply count, reply rate; breakdowns by style and match score
- History list: recent 20 records with "mark sent" and "mark replied" toggle buttons
- Export/Import: full settings backup as JSON file
- Clear history / Clear all data

---

## 6. Data Flow

### End-to-End Flow: Scan -> Generate -> Send

```
1. User opens Boss Zhipin search page
       |
2. Content Script injects floating "BossSay" button
       |
3. User clicks extension icon -> Popup opens
       |
4. Popup detects zhipin.com URL -> shows "Scan" button
       |
5. User clicks "Scan"
       |
6. Popup --[EXTRACT_JOB_INFO]--> Content Script
       |
7. Content Script extracts job cards from DOM
       |
8. Content Script --[response]--> Popup
       |   (array of { title, company, salary, location, ... })
       |
9. Popup displays first job in editable fields
       |
10. User selects style, optionally edits fields, clicks "Generate"
       |
11. Popup reads profile from storage (via Service Worker)
       |
12. Popup invokes BossAgent.run()
       |
13. BossAgent Step 1: Popup.callAPI() -> fetch AI API
       |   Returns: JD analysis + resume match
       |
14. BossAgent Step 2: Local evaluation
       |   Returns: match score + strategy
       |
15. BossAgent Step 3: Popup.callAPI() -> fetch AI API
       |   Returns: message draft + self-review
       |
16. BossAgent Step 4 (conditional): Popup.callAPI() -> fetch AI API
       |   Returns: revised message (if review found issues)
       |
17. BossAgent returns { message, trace, matchScore }
       |
18. Popup displays message, score, and reasoning trace
       |
19. BossEvaluate.recordGeneration() -> saves to history
       |
20. User reviews message, optionally edits, clicks "Fill"
       |
21. Popup --[FILL_MESSAGE]--> Content Script
       |
22. Content Script finds chat input, sets value, dispatches events
       |
23. User manually sends the message
```

### Fallback: Service Worker API Proxy

If the popup's direct `fetch()` to the AI API fails (CORS, network error), it automatically retries through the service worker:

```
Popup.fetch() --[fails]--> Popup --[AI_CHAT_COMPLETIONS]--> Service Worker --[fetch]--> AI API
```

---

## 7. Configuration

### API Setup

BossSay works with any OpenAI-compatible API. Configure in the Settings tab:

| Field | Example | Notes |
|-------|---------|-------|
| API URL | `https://api.deepseek.com` | Auto-completes `/v1/chat/completions` if missing |
| API Key | `sk-...` | Stored locally, never uploaded |
| Model Name | `deepseek-chat` | Must match the provider's model identifier |

### Model Presets

Built-in presets fill the URL and model name fields with one click:

| Preset | URL | Model |
|--------|-----|-------|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| OpenAI | `https://api.openai.com` | `gpt-4o-mini` |
| Custom | (user enters) | (user enters) |

### Style Customization

Each style has a customizable instruction string. The default instructions are:

| Style | Default Instruction |
|-------|-------------------|
| Professional | Professional, concise, confident tone. Use data and results. |
| Friendly | Warm, sincere, enthusiastic tone. Show genuine interest. |
| Humor | Light, humorous, personality-driven tone. Maintain professional baseline. |
| Concise | Max 120 characters. Highest information density. No filler. |

Users can edit these in Settings -> Style Editor. Custom instructions override defaults when the `instruction` field is present.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+B` (Mac: `Cmd+Shift+B`) | Open BossSay popup |
| `Ctrl+Shift+G` (Mac: `Cmd+Shift+G`) | Quick generate |

---

## 8. Development

### File Structure

```
boss直聘打招呼浏览器插件/
  manifest.json              -- Chrome extension manifest (v3)
  popup/
    popup.html               -- Popup UI markup
    popup.js                 -- Popup logic (1245 lines)
  background/
    service-worker.js        -- Background service (159 lines)
  content/
    content.js               -- Content script (277 lines)
  lib/
    agent.js                 -- BossAgent ReAct engine (314 lines)
    evaluate.js              -- BossEvaluate analytics (144 lines)
    pdf-extractor.js         -- PDF text/image extraction
    pdf.min.js               -- pdf.js library
    pdf.worker.min.js        -- pdf.js web worker
  icons/
    icon16.png, icon48.png, icon128.png
  docs/
    PROJECT.md               -- This file
```

### Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Extract from search page cards, not detail pages | Boss Zhipin's detail pages use CSS obfuscation (custom fonts, class shuffling). Search page cards are not obfuscated. |
| Service Worker proxies API calls | Extension popups hit CORS restrictions on direct fetch. The service worker runs in extension context with `host_permissions`. |
| Two combined API calls instead of four | Steps 1+2 and 3+4 are merged to reduce latency and token costs. Each combined call returns structured JSON. |
| No auto-send | Safety-first design. Automated sending triggers Boss Zhipin's anti-bot detection. Users always review and send manually. |
| `<all_urls>` host permission | Users may configure API endpoints on any domain. The permission is required for the service worker proxy to work. |
| History capped at 100 records | Prevents unbounded storage growth while keeping enough data for meaningful statistics. |

### Contributing

1. Fork the repository
2. Load the extension in Chrome: `chrome://extensions` -> Developer mode -> Load unpacked
3. Make changes to the source files
4. Test on Boss Zhipin (search pages and detail pages)
5. Submit a pull request

### Testing Checklist

- [ ] Scan job cards on search page
- [ ] Scan job info on detail page
- [ ] Generate message with each style (professional, friendly, humor, concise)
- [ ] Verify reasoning trace displays correctly
- [ ] Test PDF upload (text-based PDF)
- [ ] Test API connection in Settings
- [ ] Test export/import settings
- [ ] Verify message injection into chat input
- [ ] Mark messages as sent/replied and check stats
- [ ] Test with different AI providers (DeepSeek, OpenAI, etc.)

### Roadmap Ideas

- Batch scan all visible job cards
- HR activity status filtering
- CSV export of application history
- Message effectiveness tracking by keyword patterns
- Smart JD extraction from detail pages (when Boss Zhipin reduces obfuscation)
- Multi-language support
