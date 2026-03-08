Plan: JellyCore Dashboard — Professional Frontend Overhaul
สถานะปัจจุบัน: 21 pages, 25+ components, React 19 + Vite 7 + CSS Modules — feature-complete 9/10 แต่ Mobile 3/10, Accessibility 4/10, UX ยังดิบในหลายจุด

เป้าหมาย: ยกระดับ Dashboard ให้เป็นมืออาชีพ — ใช้งานได้ทุกอุปกรณ์, UX ลื่นไหล, ข้อมูลครบถ้วน

สิ่งที่พบจากการ Audit
สิ่งที่มีแล้ว (21 หน้า)
กลุ่ม หน้า สถานะ
Knowledge Overview, Feed, Search, DocDetail, Consult, Graph, Activity, Handoff ครบ
Collaboration Forum, Decisions, Traces, Evolution, Superseded ครบ
Operations LiveOps, Scheduler, JobDetail, SystemHealth, HeartbeatConfig ครบ
Admin Admin, AdminMemory, AdminLogs ครบ
Chat Chat (terminal-style, real-time via SSE) มีแล้ว แต่ UX ดิบ
ปัญหาที่พบ (จัดลำดับ)

# ปัญหา ความรุนแรง หน้าที่กระทบ

1 Mobile ใช้ไม่ได้จริง — Sidebar ไม่ collapse, Chart ขนาดตายตัว, Graph 3D broken 🔴 Critical 15+ หน้า
2 Document type pattern หายจาก UI — มีใน DB schema แต่ Filter แสดงแค่ principle/learning/retro 🔴 Critical Feed, Search, LogCard
3 Chat UX ดิบ — Terminal-only style, ไม่มี typing indicator, trace panel scroll ไม่ได้ 🟡 High Chat
4 3D Graph ไม่มี fallback — MediaPipe CDN ล่ม = หน้าค้าง 🟡 High Graph
5 ไม่มี Design System — ปุ่ม/Card/Modal สร้างใหม่ทุกหน้า ไม่ reuse 🟡 High ทุกหน้า
6 Search จำกัด 50 results ไม่มี pagination 🟡 Medium Search
7 AdminLogs ไม่มี sort/export — 200 entries ดิบๆ 🟡 Medium AdminLogs
8 ไม่มี Loading Skeleton — ทุกหน้าแสดง "Loading..." text เฉยๆ 🟢 Low ทุกหน้า
9 ไม่มี Dark/Light toggle — CSS variables มีแล้วแต่ไม่มี switcher 🟢 Low ทุกหน้า
10 Accessibility ต่ำ — ไม่มี ARIA labels, focus indicators, color contrast 🟢 Low ทุกหน้า
แผนพัฒนา — 5 Phases
Phase A — Design System & Foundation
สร้างรากฐานที่ reuse ได้ทั้งโปรเจค ก่อนแก้หน้าใดหน้าหนึ่ง

Steps:

Design Token System — รวม CSS Custom Properties ที่กระจายอยู่ใน index.css ให้เป็นระบบ

สร้าง tokens.css — color, spacing (4/8/12/16/24/32/48px), border-radius, shadow, z-index
สร้าง typography.css — font-size scale (xs/sm/base/lg/xl/2xl), line-height, font-weight
สร้าง breakpoints.css — mobile (≤480), tablet (≤768), desktop (≤1024), wide (>1024)
Shared Component Library — สร้าง reusable components ที่ตอนนี้ทุกหน้าเขียนเอง

Button — primary/secondary/danger/ghost variants + loading state + disabled
Card — สร้างจาก stat card pattern ที่ใช้ซ้ำใน Overview, Activity, SystemHealth
Badge — document type, status, category (merge CategoryBadge logic)
Modal — standardize จาก pattern ที่ใช้ใน Consult/Forum/Decisions/JobForm
Toast — notification system (success/error/info) แทนที่ inline message
Skeleton — loading placeholder component
EmptyState — icon + message + action button
Theme System — Light/Dark toggle

เพิ่ม [data-theme="light"] CSS variables ใน tokens.css
สร้าง useTheme() hook + ThemeProvider — persist ใน localStorage
เพิ่ม toggle button ใน Header.tsx
ธีมปัจจุบัน (terminal-green on dark) = default "dark"
Global Error Boundary

Wrap ทุก Route ด้วย <ErrorBoundary> — แสดง fallback UI แทน white screen
เพิ่ม useErrorBoundary() hook สำหรับ async errors
Relevant files:

index.css — CSS variables ปัจจุบัน
App.tsx — Route wrapper
components — ทุก component ที่มี
Verification:

ทุก shared component มี story/visual test
Light mode ต้องอ่านได้ทุกหน้า (contrast ratio ≥4.5:1)
ไม่มีหน้าไหน crash เป็น white screen
Phase B — Mobile & Responsive
ทำให้ใช้งานได้จริงบนมือถือ — ปัจจุบัน 15+ หน้าพังบน mobile

Steps:

Header: Hamburger Menu — parallel with step 2

เพิ่ม hamburger icon ที่ ≤768px
Nav items → slide-in drawer (overlay)
Tools dropdown → section ใน drawer
Session stats → collapse ในเมนู
แก้ไขใน Header.tsx + Header.module.css
SidebarLayout: Drawer Pattern — parallel with step 1

≤768px: sidebar ซ่อน, แสดงปุ่ม filter icon ที่ header
กดเปิด = slide-in drawer จากซ้าย
กระทบ 6 หน้า: Feed, Forum, Decisions, Evolution, Traces, Superseded
แก้ไขใน SidebarLayout.tsx
Charts: Responsive Sizing — depends on step 1, 2

Activity page: Recharts LineChart ปัจจุบัน hard-coded 800x600
ใช้ ResponsiveContainer จาก Recharts (มี built-in) แทน fixed size
ResourceChart ใน SystemHealth เช่นกัน
แก้ไขใน Activity.tsx, ResourceChart.tsx
Graph: Mobile Safety — parallel with step 3

2D Graph: ใช้ parent container width แทน hard-coded canvas size + add touch drag/pinch-zoom
3D Graph: เพิ่ม try/catch รอบ MediaPipe loading — ล้มเหลว = auto-fallback เป็น 2D พร้อม toast warning
Disable hand tracking button on mobile (ไม่มี webcam consent UX ดีพอ)
แก้ไขใน Graph.tsx, useHandTracking.ts
Forms: Mobile Optimization

JobFormModal: full-screen modal on mobile
DurationPicker: ใช้ native number input + dropdown
Consult form: stack fields vertically
Chat input: larger touch target, send button visible
Modal: Full-screen on Mobile

≤480px: modal เป็น full-screen slide-up
เพิ่ม close button ชัดเจน (ไม่ใช่แค่ click overlay)
กระทบ: Consult, Forum, Decisions, JobForm, DocDetail raw viewer
Verification:

ทดสอบทุกหน้าบน viewport 375px (iPhone SE) + 768px (iPad)
Sidebar collapse ทำงานที่ ≤768px
Charts ไม่ overflow container
Graph 3D ไม่ hang ถ้า MediaPipe โหลดไม่ได้
Phase C — Chat Page Overhaul
ยก Chat จาก terminal-style ดิบๆ ให้เป็น professional chat interface

สถานะปัจจุบัน (Chat.tsx):

Terminal-style monospace text
Group folder selector
SSE live events (container lifecycle)
Polling history ทุก 2.5 วินาที
Processing hints (delays)
Fallback: proxy → direct NanoClaw
ไม่มี: message bubbles, typing indicator, message actions, scroll anchor
Steps:

Message Bubble UI — ก่อนทุกอย่าง

แยก message role ออกเป็น bubble styles:
human → aligned ขวา, สีน้ำเงินอ่อน
oracle/claude → aligned ซ้าย, สี accent
system → center, สีเทา, font เล็ก
แสดง avatar icon ต่อ role (user, AI, system)
Timestamp แสดงแบบ relative ("2m ago") + hover = absolute
Markdown rendering ใน message (ใช้ react-markdown ที่มีอยู่)
Code blocks ใน message ต้อง syntax highlight + copy button
Typing Indicator & Processing State — depends on step 1

เมื่อ container:start event มา → แสดง animated typing dots ใน AI bubble
แสดง stage: "Thinking..." → "Processing..." → "Writing response..."
Container output (streaming) → แสดงเป็น live-updating message bubble (ไม่ใช่ terminal)
ใช้ container:output events จาก useLiveEvents ที่มีอยู่
Message Actions — depends on step 1

Hover/long-press message → action bar:
📋 Copy (plain text)
🔄 Retry (resend same prompt)
📌 Pin (bookmark message — localStorage)
AI messages เพิ่ม: "View in Oracle" → link ไป DocDetail ถ้า message อ้างอิง document
Group Selector Improvement

ปัจจุบัน: dropdown เปล่าๆ
ปรับเป็น: group card แสดง name + last active + member count
Quick switch: keyboard shortcut (Ctrl+G)
แสดง unread indicator per group (จาก polling diff)
Scroll & Session UX

Auto-scroll to bottom on new message (with "scroll to latest" button ถ้า user scroll ขึ้น)
"New messages" divider เมื่อกลับมาจากหน้าอื่น
Session persistence: เก็บ draft message ใน sessionStorage
Shift+Enter = newline, Enter = send (toggle ได้ใน settings)
Execution Trace Panel — parallel with step 5

Panel ปัจจุบัน: unscrollable, ติดด้านข้าง
ปรับเป็น: collapsible bottom panel (เหมือน Chrome DevTools)
แสดง timeline: task enqueue → container start → chunks → end
แต่ละ step มี duration + status icon
Mobile: ซ่อน trace panel, เข้าถึงผ่าน swipe-up sheet
Relevant files:

Chat.tsx — overhaul target
chat.ts — API client (reuse)
useLiveEvents.ts — SSE events (reuse)
Verification:

Message bubbles render Markdown ถูกต้อง (bold, code block, list)
Typing indicator แสดงเมื่อ container running, หายเมื่อ end
Copy button คัดลอก plain text ไม่ใช่ HTML
Scroll behavior: auto-scroll ไม่กระโดดเมื่อ user อ่านข้อความเก่า
Mobile: input area ไม่ถูก keyboard บัง (iOS Safari fix)
Phase D — Knowledge & Data Completeness
เติมเต็มข้อมูลที่ขาดหาย ทำให้ทุก document type ใช้งานได้ครบ

Steps:

เพิ่ม pattern Document Type ในทุก UI — ก่อนเลย เป็น bug fix

DB schema มี 4 types: principle | pattern | learning | retro
UI filter มีแค่ 3: principle, learning, retro — pattern หายไป
แก้ไขใน:
SidebarLayout.tsx — เพิ่ม "Patterns" filter button
LogCard.tsx — เพิ่ม pattern type icon/color (เช่น 🔧 สีม่วง)
Feed.tsx — เพิ่ม pattern ใน type dropdown
Overview.tsx — เพิ่ม Patterns count ใน stats grid
Graph.tsx — เพิ่มสีใหม่ในกลุ่ม node types + legend
Search: Advanced Filters — parallel with step 1

เพิ่ม filter panel ด้านซ้ายของ Search (ใช้ SidebarLayout)
Filters:
Type: principle / pattern / learning / retro (checkbox)
Date range: from — to (date picker)
Project: dropdown จาก available projects
Memory Layer: semantic / procedural / episodic / user_model
Search mode: hybrid (default) / FTS only / Vector only
API รองรับ params ทั้งหมดแล้ว (type, mode, project, layer)
Search: Pagination — depends on step 2

เปลี่ยนจาก hard-code limit=50 เป็น paginated
แสดง "Page 1 of N" + Prev/Next buttons
หรือ infinite scroll (Load More pattern เหมือน Feed)
แสดง total results count จาก API
AdminLogs: Sort, Filter, Export — parallel with step 2

Sort by: timestamp (asc/desc), type, query
Filter by: type dropdown, date range, query text search
Export: ปุ่ม "Export CSV" + "Export JSON" — browser-side (ไม่ต้อง backend ใหม่)
เพิ่ม pagination (20 per page แทน 200 dump)
แก้ไขใน AdminLogs.tsx
Document Upload — last, depends on Phase A components

ปุ่ม "Upload Knowledge" ใน Feed หรือ Overview
Form: paste markdown content + set type + concepts (tags input)
ใช้ /api/learn endpoint ที่มีอยู่แล้ว
Preview rendering ก่อน submit
Drag-and-drop .md file support
Memory Layer Visibility — parallel with step 5

Overview page: เพิ่ม memory layer breakdown (Layer 1-4 counts)
AdminMemory: ปรับ JSON editor ให้มี syntax highlighting (ใช้ textarea + CSS highlights ง่ายๆ)
Episodes tab: เพิ่ม search/filter + pagination
Procedures tab: แสดง usage count chart (Recharts มีอยู่)
Verification:

Feed filter เปลี่ยนเป็น "Pattern" → แสดง pattern documents ถูกต้อง
Overview stats grid แสดง 4 types (principle, pattern, learning, retro)
Search advanced filter ผลลัพธ์ตรงกับ filter ที่เลือก
AdminLogs export CSV เปิดใน Excel ได้ถูกต้อง
Upload document → ปรากฏใน Feed ทันที
Phase E — Polish & Professional UX
ขัดเงา detail เล็กๆ ที่รวมกันทำให้ระบบดูมืออาชีพ

Steps:

Skeleton Loading States — ก่อนเลย

แทนที่ "Loading..." text ทุกหน้าด้วย skeleton animated placeholders
Pattern: card skeleton, table row skeleton, chart skeleton
ใช้ CSS animation (@keyframes shimmer) ไม่ต้องเพิ่ม library
หน้าที่กระทบ: Overview, Feed, Search, Activity, Admin, SystemHealth, Scheduler, Chat
Toast Notification System — parallel with step 1

Global toast container (top-right)
4 variants: success (green), error (red), warning (yellow), info (blue)
Auto-dismiss 5s, manual dismiss
ใช้แทน: inline success/error messages ที่กระจายอยู่ทุกหน้า
สร้าง useToast() hook + <ToastProvider> ใน App.tsx
Keyboard Shortcut Overlay — parallel with step 1

กด ? → แสดง overlay ของ shortcuts ทั้งหมด
Global shortcuts: / = focus search, G+F = go to feed, G+C = go to chat
Page-specific: DocDetail (J/K/U), Chat (Shift+Enter)
แสดง shortcut hints ใน tooltip ของปุ่มสำคัญ
Empty State Illustrations — depends on Phase A

แทนที่ข้อความ "No data" ด้วย illustration + actionable message:
Search 0 results → "No results found. Try different keywords" + suggestion pills
Feed empty filter → "No [type] documents yet" + "Upload one" button
Forum no threads → "Start a conversation" + create button
Scheduler no jobs → "Schedule your first task" + create button
ใช้ SVG inline (ไม่ต้อง library — วาด simple geometric art)
Accessibility Pass — parallel with step 4

เพิ่ม aria-label ให้ทุก icon button (hamburger, close, filter, etc.)
เพิ่ม role="dialog" + aria-modal="true" ให้ทุก Modal
Focus trap ใน Modal (Tab ไม่หลุดออกนอก modal)
Visible focus ring (:focus-visible outline) ทุก interactive element
Color contrast check (WCAG AA ≥4.5:1) ทุก text/background pair
Status indicators: ใช้ icon + text ไม่ใช่แค่สี (🟢 Healthy / 🔴 Error)
Performance Guard — last

Lazy-load Graph component (3D/THREE.js ไม่ต้องโหลดถ้าไม่เข้าหน้า)
Lazy-load AdminMemory, AdminLogs (admin pages)
Image/asset lazy loading
React.memo() สำหรับ LogCard, JobCard, ServiceCard ที่ render list ยาว
Bundle analysis: ตรวจ three.js + ml5 ว่ากิน bundlesize เท่าไหร่
Verification:

Lighthouse score: Performance ≥90, Accessibility ≥90, Best Practices ≥90
Keyboard-only navigation: สามารถใช้ทุกฟีเจอร์โดยไม่ต้องใช้ mouse
Empty states ทุกหน้ามี actionable CTA (ไม่ใช่แค่ข้อความ)
Toast ไม่ block interaction, ซ้อนกันได้ ≥3
Bundle size: main chunk < 300KB gzipped (ไม่รวม three.js lazy chunk)
ลำดับความสำคัญ & Dependencies
สิ่งที่ทำได้ parallel:

Phase A + D.1 (pattern type fix)
Phase B + C (mobile + chat)
Phase D.2-4 (search filters + logs + pagination)
Relevant Files Summary
ไฟล์ ทำอะไร Phase
index.css Design tokens, theme variables A
App.tsx Error boundary, ToastProvider, ThemeProvider A, E
Header.tsx Hamburger menu, theme toggle A, B
SidebarLayout.tsx Mobile drawer, pattern filter B, D
LogCard.tsx Pattern type badge D
Chat.tsx Full overhaul C
Search.tsx Advanced filters, pagination D
Activity.tsx Responsive chart B
Graph.tsx Mobile fallback, touch, pattern color B, D
Overview.tsx Pattern stat, skeleton D, E
Feed.tsx Pattern filter D
AdminLogs.tsx Sort, filter, export D
AdminMemory.tsx JSON highlighting, layer stats D
useLiveEvents.ts Reuse for chat typing indicator C
useHandTracking.ts Error boundary fallback B
oracle.ts Search params expansion D
chat.ts Reuse for chat overhaul C
New Files to Create (~15 files)
ไฟล์ใหม่ Phase Purpose
src/styles/tokens.css A Design tokens (colors, spacing, typography)
src/styles/breakpoints.css A Media query mixins
src/components/ui/Button.tsx A Shared button component
src/components/ui/Card.tsx A Shared card component
src/components/ui/Modal.tsx A Shared modal with focus trap
src/components/ui/Toast.tsx + useToast.ts A, E Notification system
src/components/ui/Skeleton.tsx E Loading placeholder
src/components/ui/EmptyState.tsx E Empty state with illustration
src/components/ErrorBoundary.tsx A Global error catch
src/hooks/useTheme.ts A Dark/Light toggle logic
src/hooks/useKeyboardShortcuts.ts E Global shortcut registry
src/pages/Chat.module.css C Chat bubble styles (new)
src/components/ChatBubble.tsx C Message bubble component
src/components/TypingIndicator.tsx C Animated typing dots
src/components/KeyboardShortcutOverlay.tsx E Shortcut help modal
