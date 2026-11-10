const pptxgen = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

console.log('[PPTX] Initializing presentation generator with vector flowcharts & authentic UI screenshots...');

const pptx = new pptxgen();

// Enforce standard 16:9 Widescreen (13.333 x 7.5 inches)
pptx.layout = 'LAYOUT_WIDE';

// High-End Dark Cinematic Obsidian & Mint Emerald Palette (Tokens without #)
const COLOR_BG = '0D0E0D';              // Deep Obsidian Background
const COLOR_SURFACE = '141715';         // Nocturnal Slate Canvas
const COLOR_CARD = '1A1E1B';            // Charcoal Card Surface
const COLOR_CARD_ELEVATED = '222723';   // Highlighted Card Surface
const COLOR_BORDER = '2C352F';          // Subtle Structural Border
const COLOR_BORDER_MINT = '005447';     // Dark Emerald Border
const COLOR_MINT = '00F5B4';            // Luminous Bioluminescent Mint
const COLOR_CYAN = '67E2C8';            // Soft Mint Teal
const COLOR_PINE = '062E25';            // Deep Forest Pine
const COLOR_TEXT = 'F7FAF7';            // Pure Crisp White
const COLOR_TEXT_MUTED = 'A3ACA5';      // Taupe Slate Gray
const COLOR_RED_BORDER = '7F1D1D';      // Warning Red Border
const COLOR_RED_BG = '1F1212';          // Dark Warning Plate
const COLOR_RED_TEXT = 'FCA5A5';        // High-contrast Warning Text
const COLOR_GOLD = 'FBBF24';            // Accent Gold for latency pills

// Common Header for Slides 2-10
function addSlideHeader(slide, title, category, slideNum) {
  // Category Pill
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8, y: 0.45, w: 2.2, h: 0.32,
    rectRadius: 0.16,
    fill: { color: COLOR_PINE },
    line: { color: COLOR_MINT, width: 1 }
  });
  slide.addText(category.toUpperCase(), {
    x: 0.8, y: 0.45, w: 2.2, h: 0.32,
    fontSize: 9, bold: true, color: COLOR_MINT,
    align: 'center', valign: 'middle', fontFace: 'Segoe UI'
  });

  // Action Title
  slide.addText(title, {
    x: 0.8, y: 0.85, w: 9.6, h: 0.55,
    fontSize: 22, bold: true, color: COLOR_TEXT,
    valign: 'middle', fontFace: 'Segoe UI'
  });

  // Top-Right Branding Badge
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 10.7, y: 0.45, w: 1.83, h: 0.32,
    rectRadius: 0.16,
    fill: { color: COLOR_SURFACE },
    line: { color: COLOR_BORDER, width: 1 }
  });
  slide.addText('PENTONE COPILOT', {
    x: 10.7, y: 0.45, w: 1.83, h: 0.32,
    fontSize: 8.5, bold: true, color: COLOR_TEXT_MUTED,
    align: 'center', valign: 'middle', fontFace: 'Segoe UI'
  });

  // Footer separator rule
  slide.addShape(pptx.ShapeType.line, {
    x: 0.8, y: 6.8, w: 11.733, h: 0,
    line: { color: COLOR_BORDER, width: 1 }
  });

  // Footer Presenter & Institution Meta
  slide.addText('Raghav Mishra  •  B.Tech CSE  •  LNCT University', {
    x: 0.8, y: 6.9, w: 6.5, h: 0.35,
    fontSize: 9.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI'
  });

  // Footer Page Number Indicator
  slide.addText(`Slide ${slideNum} of 10`, {
    x: 10.5, y: 6.9, w: 2.03, h: 0.35,
    fontSize: 9.5, color: COLOR_CYAN, bold: true,
    align: 'right', fontFace: 'Segoe UI'
  });
}

// Helper to draw connecting arrows with optional mini badges
function addArrow(slide, x, y, w, h, label = '') {
  slide.addShape(pptx.ShapeType.rightArrow, {
    x: x, y: y, w: w, h: h,
    fill: { color: COLOR_MINT },
    line: { color: COLOR_MINT, width: 0 }
  });
  if (label) {
    slide.addText(label, {
      x: x - 0.2, y: y - 0.28, w: w + 0.4, h: 0.25,
      fontSize: 7.5, bold: true, color: COLOR_CYAN,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });
  }
}

// Helper to embed authentic product screenshots inside an elegant dark window frame
function addMockupFrame(slide, { x, y, w, h, title, imagePath, imgW, imgH, caption }) {
  // Container Box
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x, y: y, w: w, h: h,
    rectRadius: 0.12,
    fill: { color: COLOR_SURFACE },
    line: { color: COLOR_BORDER, width: 1.2 }
  });

  // Window Top Title Bar
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x, y: y, w: w, h: 0.32,
    rectRadius: 0.1,
    fill: { color: COLOR_CARD },
    line: { color: COLOR_BORDER, width: 0 }
  });

  // 3 macOS/Chrome window control dots
  slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.15, y: y + 0.1, w: 0.12, h: 0.12, fill: { color: 'EF4444' } });
  slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.32, y: y + 0.1, w: 0.12, h: 0.12, fill: { color: 'F59E0B' } });
  slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.49, y: y + 0.1, w: 0.12, h: 0.12, fill: { color: '10B981' } });

  // Window URL / Title Label
  slide.addText(title, {
    x: x + 0.7, y: y + 0.05, w: w - 0.8, h: 0.22,
    fontSize: 8, color: COLOR_TEXT_MUTED, fontFace: 'Consolas'
  });

  // Inner Image (Exact aspect ratio, no oval distortion)
  if (fs.existsSync(imagePath)) {
    slide.addImage({
      path: imagePath,
      x: x + (w - imgW) / 2,
      y: y + 0.36 + ((h - 0.36 - (caption ? 0.3 : 0)) - imgH) / 2,
      w: imgW,
      h: imgH
    });
  }

  // Optional Bottom Caption
  if (caption) {
    slide.addText(caption, {
      x: x + 0.1, y: y + h - 0.3, w: w - 0.2, h: 0.25,
      fontSize: 8, bold: true, color: COLOR_CYAN,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });
  }
}

// Screenshot asset paths
const SCREENSHOT_DIR = path.join(__dirname, '..', 'assets', 'presentation-screenshots');
const SHOT_VOICE = path.join(SCREENSHOT_DIR, 'pentone_voice_ui.png');
const SHOT_CHAT = path.join(SCREENSHOT_DIR, 'pentone_chat_ui.png');
const SHOT_SETUP = path.join(SCREENSHOT_DIR, 'pentone_ai_engine_setup.png');
const SHOT_AUTOFILL = path.join(SCREENSHOT_DIR, 'pentone_form_autofill.png');
const SHOT_REWRITE = path.join(SCREENSHOT_DIR, 'pentone_inpage_rewrite.png');

// ==================================================================================
// SLIDE 1: Title Slide (Hero Opening)
// Presenter: Raghav Mishra | B.Tech CSE | LNCT University
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };

  // Subtle Emerald Atmospheric Light in Background
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 8.0, y: -1.0, w: 6.0, h: 6.0,
    fill: { color: '00382E', transparency: 75 }
  });

  // Left Section: Project Narrative & Vision (x: 0.8 to 8.2)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8, y: 1.1, w: 3.4, h: 0.36,
    rectRadius: 0.18,
    fill: { color: COLOR_PINE },
    line: { color: COLOR_MINT, width: 1 }
  });
  slide.addText('100% PRIVATE • ON-DEVICE AI', {
    x: 0.8, y: 1.1, w: 3.4, h: 0.36,
    fontSize: 9.5, bold: true, color: COLOR_MINT,
    align: 'center', valign: 'middle', fontFace: 'Segoe UI'
  });

  // Main Brand Name
  slide.addText('PENTONE', {
    x: 0.8, y: 1.7, w: 7.2, h: 1.1,
    fontSize: 56, bold: true, color: COLOR_TEXT,
    fontFace: 'Segoe UI', charSpacing: 1.5
  });

  // Punchy Subtitle
  slide.addText('Autonomous, Voice-First On-Device AI Browser Copilot', {
    x: 0.8, y: 2.85, w: 7.2, h: 0.55,
    fontSize: 20, bold: true, color: COLOR_MINT,
    fontFace: 'Segoe UI'
  });

  // Elevator Pitch / Core Thesis
  slide.addText(
    'Navigating, extracting, synthesizing, and automating the modern web completely offline with Chrome Gemini Nano, on-device vector retrieval, and zero cloud telemetry.',
    {
      x: 0.8, y: 3.5, w: 7.2, h: 1.0,
      fontSize: 13, color: COLOR_TEXT_MUTED,
      fontFace: 'Segoe UI', lineSpacing: 20
    }
  );

  // Architecture Pillars Tag Bar
  const tags = ['CHROME GEMINI NANO', 'ONNX WASM (384-D)', 'MANIFEST V3 HYBRID', 'ZERO TELEMETRY'];
  tags.forEach((tag, idx) => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.8 + idx * 1.85, y: 4.75, w: 1.75, h: 0.34,
      rectRadius: 0.17,
      fill: { color: COLOR_SURFACE },
      line: { color: COLOR_BORDER, width: 1 }
    });
    slide.addText(tag, {
      x: 0.8 + idx * 1.85, y: 4.75, w: 1.75, h: 0.34,
      fontSize: 8, bold: true, color: COLOR_CYAN,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });
  });

  // Right Section: Presenter & Institution Identity Card (x: 8.5, w: 4.0, h: 4.9)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.5, y: 1.2, w: 4.0, h: 4.9,
    rectRadius: 0.2,
    fill: { color: COLOR_CARD },
    line: { color: COLOR_BORDER_MINT, width: 1.5 }
  });

  // Inner Accent Glow Header
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.8, y: 1.5, w: 3.4, h: 0.32,
    rectRadius: 0.16,
    fill: { color: COLOR_PINE },
    line: { color: COLOR_MINT, width: 0.8 }
  });
  slide.addText('PROJECT PRESENTATION', {
    x: 8.8, y: 1.5, w: 3.4, h: 0.32,
    fontSize: 8.5, bold: true, color: COLOR_MINT,
    align: 'center', valign: 'middle', fontFace: 'Segoe UI'
  });

  // Presenter Label & Name
  slide.addText('PRESENTER', {
    x: 8.8, y: 2.1, w: 3.4, h: 0.25,
    fontSize: 9.5, bold: true, color: COLOR_CYAN, fontFace: 'Segoe UI'
  });
  slide.addText('Raghav Mishra', {
    x: 8.8, y: 2.38, w: 3.4, h: 0.45,
    fontSize: 22, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
  });
  slide.addText('Creator & Lead System Architect', {
    x: 8.8, y: 2.85, w: 3.4, h: 0.25,
    fontSize: 10.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI'
  });

  // Divider
  slide.addShape(pptx.ShapeType.line, {
    x: 8.8, y: 3.25, w: 3.4, h: 0,
    line: { color: COLOR_BORDER, width: 1 }
  });

  // Branch & Specialization
  slide.addText('BRANCH & SPECIALIZATION', {
    x: 8.8, y: 3.45, w: 3.4, h: 0.25,
    fontSize: 9.5, bold: true, color: COLOR_CYAN, fontFace: 'Segoe UI'
  });
  slide.addText('B.Tech CSE', {
    x: 8.8, y: 3.72, w: 3.4, h: 0.42,
    fontSize: 19, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
  });
  slide.addText('Computer Science & Engineering', {
    x: 8.8, y: 4.15, w: 3.4, h: 0.25,
    fontSize: 10.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI'
  });

  // Divider
  slide.addShape(pptx.ShapeType.line, {
    x: 8.8, y: 4.5, w: 3.4, h: 0,
    line: { color: COLOR_BORDER, width: 1 }
  });

  // Institution / University
  slide.addText('INSTITUTION', {
    x: 8.8, y: 4.65, w: 3.4, h: 0.25,
    fontSize: 9.5, bold: true, color: COLOR_CYAN, fontFace: 'Segoe UI'
  });
  slide.addText('LNCT University', {
    x: 8.8, y: 4.92, w: 3.4, h: 0.42,
    fontSize: 18, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
  });
  slide.addText('School of Engineering & Technology', {
    x: 8.8, y: 5.35, w: 3.4, h: 0.25,
    fontSize: 10.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI'
  });

  // Bottom Footer Rule
  slide.addShape(pptx.ShapeType.line, {
    x: 0.8, y: 6.8, w: 11.733, h: 0,
    line: { color: COLOR_BORDER, width: 1 }
  });
  slide.addText('Raghav Mishra  •  B.Tech CSE  •  LNCT University', {
    x: 0.8, y: 6.9, w: 6.5, h: 0.35,
    fontSize: 9.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI'
  });
  slide.addText('Slide 1 of 10', {
    x: 10.5, y: 6.9, w: 2.03, h: 0.35,
    fontSize: 9.5, color: COLOR_CYAN, bold: true,
    align: 'right', fontFace: 'Segoe UI'
  });
}

// ==================================================================================
// SLIDE 2: Problem Statement: The Cloud AI Dilemma
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };
  addSlideHeader(slide, 'The Inherent Flaws of Cloud AI for Browsing', 'Problem Statement', 2);

  // Left Card: The Vulnerable Cloud Model (x: 0.8, w: 5.7, h: 4.9)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8, y: 1.6, w: 5.7, h: 4.9,
    rectRadius: 0.15,
    fill: { color: COLOR_RED_BG },
    line: { color: COLOR_RED_BORDER, width: 1.5 }
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.1, y: 1.85, w: 3.2, h: 0.32,
    rectRadius: 0.16,
    fill: { color: '450A0A' },
    line: { color: 'DC2626', width: 0.8 }
  });
  slide.addText('CURRENT CLOUD AI PARADIGM', {
    x: 1.1, y: 1.85, w: 3.2, h: 0.32,
    fontSize: 8.5, bold: true, color: COLOR_RED_TEXT,
    align: 'center', valign: 'middle', fontFace: 'Segoe UI'
  });

  const cloudIssues = [
    { title: 'Severe Privacy & Data Leaks', desc: 'Active browser DOM, sensitive banking portals, private emails, and enterprise code piped over remote third-party servers.' },
    { title: 'Sluggish Multi-Second Latency', desc: '1,500ms to 4,000ms network round-trips disrupt fluid web navigation, voice conversations, and rapid DOM execution.' },
    { title: 'Fragile Offline Dependence', desc: 'Zero functionality on airplanes, subways, intermittent field sites, or during upstream API rate-limit outages.' },
    { title: 'Continuous Subscription Paywalls', desc: '$20/month SaaS subscriptions or metering per-token API charges scale endlessly with everyday browsing.' }
  ];

  let yOffset = 2.35;
  cloudIssues.forEach((item, i) => {
    slide.addText(`0${i + 1}.  ${item.title}`, {
      x: 1.1, y: yOffset, w: 5.1, h: 0.3,
      fontSize: 12.5, bold: true, color: COLOR_RED_TEXT, fontFace: 'Segoe UI'
    });
    slide.addText(item.desc, {
      x: 1.1, y: yOffset + 0.3, w: 5.1, h: 0.6,
      fontSize: 10.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 15
    });
    yOffset += 1.0;
  });

  // Right Card: The Pentone On-Device Solution (x: 6.8, w: 5.7, h: 4.9)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 6.8, y: 1.6, w: 5.7, h: 4.9,
    rectRadius: 0.15,
    fill: { color: COLOR_CARD },
    line: { color: COLOR_MINT, width: 1.5 }
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7.1, y: 1.85, w: 3.2, h: 0.32,
    rectRadius: 0.16,
    fill: { color: COLOR_PINE },
    line: { color: COLOR_MINT, width: 0.8 }
  });
  slide.addText('PENTONE LOCAL ARCHITECTURE', {
    x: 7.1, y: 1.85, w: 3.2, h: 0.32,
    fontSize: 8.5, bold: true, color: COLOR_MINT,
    align: 'center', valign: 'middle', fontFace: 'Segoe UI'
  });

  const pentoneSolutions = [
    { title: 'Total Data Sovereignty & Zero Egress', desc: '100% of LLM reasoning, semantic vector search, and DOM parsing executes strictly on client hardware (NPU/GPU).' },
    { title: 'Instant Sub-50ms Token Streaming', desc: 'Direct browser-native Gemini Nano integration eliminates external network bottlenecks and provides real-time streaming.' },
    { title: 'True Offline Autonomy', desc: 'Operates seamlessly with zero active internet connection, preserving full intelligence in air-gapped environments.' },
    { title: 'Zero Recurring Cost & Free Forever', desc: 'No token pricing, no remote server fees, no API key setup, and zero telemetry data harvesting.' }
  ];

  yOffset = 2.35;
  pentoneSolutions.forEach((item, i) => {
    slide.addText(`0${i + 1}.  ${item.title}`, {
      x: 7.1, y: yOffset, w: 5.1, h: 0.3,
      fontSize: 12.5, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
    });
    slide.addText(item.desc, {
      x: 7.1, y: yOffset + 0.3, w: 5.1, h: 0.6,
      fontSize: 10.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 15
    });
    yOffset += 1.0;
  });
}

// ==================================================================================
// SLIDE 3: System Architecture & Manifest V3 Multi-Context Pipeline
// Flowchart: Built natively with PowerPoint vector shapes & directional flows!
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };
  addSlideHeader(slide, 'High-Level MV3 Multi-Context Communication Flow', 'System Architecture', 3);

  slide.addText('Manifest V3 Decoupled Event Pipeline with Zero Remote Code Execution', {
    x: 0.8, y: 1.45, w: 11.733, h: 0.3,
    fontSize: 11.5, color: COLOR_CYAN, fontFace: 'Segoe UI'
  });

  // 4 Primary Context Nodes Arranged Across Top Flow (y: 1.85, h: 2.7)
  const nodeW = 2.65;
  const gap = 0.37;
  const nodes = [
    {
      kicker: 'LAYER 1: DOM IN-PAGE',
      title: 'Content Script',
      sub: 'Isolated In-Page DOM Driver',
      badge: 'DOM BRIDGE',
      bullets: [
        'MutationObserver tracks live DOM updates',
        'Bounding-box coordinate resolver',
        'Dispatches synthetic trusted click/type events'
      ]
    },
    {
      kicker: 'LAYER 2: EVENT BUS',
      title: 'Service Worker',
      sub: 'Stateless MV3 Event Broker',
      badge: 'CENTRAL ROUTER',
      bullets: [
        'Handles chrome.runtime messages',
        'Coordinates multi-tab navigation states',
        'Dispatches alarms & lifecycle lifespans'
      ]
    },
    {
      kicker: 'LAYER 3: AI SANDBOX',
      title: 'Offscreen Document',
      sub: 'Heavy Local Compute Engine',
      badge: 'WASM RUNTIME',
      bullets: [
        'Executes ONNX WASM all-MiniLM-L6-v2',
        'Encrypted IndexedDB Vector Vault',
        'PDF.js binary parsing & tokenization'
      ]
    },
    {
      kicker: 'LAYER 4: CONTROL SURFACE',
      title: 'SidePanel & UI',
      sub: 'React 18 Reactive Interface',
      badge: 'HUMAN INTERACTION',
      bullets: [
        'Chrome Gemini Nano Prompt API driver',
        'Voice Surfer streaming visual feedback',
        'Form Autofill approval controls'
      ]
    }
  ];

  nodes.forEach((node, idx) => {
    const xPos = 0.8 + idx * (nodeW + gap);

    // Node Box
    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 1.85, w: nodeW, h: 2.75,
      rectRadius: 0.14,
      fill: { color: COLOR_CARD },
      line: { color: idx === 1 ? COLOR_MINT : COLOR_BORDER, width: idx === 1 ? 1.5 : 1.2 }
    });

    // Node Kicker Pill
    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos + 0.15, y: 2.0, w: nodeW - 0.3, h: 0.26,
      rectRadius: 0.13,
      fill: { color: COLOR_PINE },
      line: { color: COLOR_MINT, width: 0.8 }
    });
    slide.addText(node.kicker, {
      x: xPos + 0.15, y: 2.0, w: nodeW - 0.3, h: 0.26,
      fontSize: 7.5, bold: true, color: COLOR_MINT,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });

    // Node Title & Subtitle
    slide.addText(node.title, {
      x: xPos + 0.15, y: 2.35, w: nodeW - 0.3, h: 0.35,
      fontSize: 13, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
    });
    slide.addText(node.sub, {
      x: xPos + 0.15, y: 2.68, w: nodeW - 0.3, h: 0.25,
      fontSize: 8.5, color: COLOR_CYAN, fontFace: 'Segoe UI'
    });

    // Bullets
    let yB = 3.0;
    node.bullets.forEach(b => {
      slide.addText('• ' + b, {
        x: xPos + 0.15, y: yB, w: nodeW - 0.3, h: 0.45,
        fontSize: 8.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 12
      });
      yB += 0.48;
    });

    // Connecting Arrow between cards
    if (idx < 3) {
      addArrow(slide, xPos + nodeW + 0.06, 3.1, gap - 0.12, 0.18, 'IPC Bus');
    }
  });

  // Bottom Layer: 4 Architecture Guarantees & Protocols (y: 4.85, h: 1.65)
  const guarantees = [
    { title: 'Strict Tab Origin Isolation', desc: 'Content scripts are sandboxed with CSP Level 3. Zero access to internal extension tokens.' },
    { title: 'Stateless Message Bus', desc: 'Service worker wakes on demand and suspends immediately, maintaining near-zero idle memory.' },
    { title: 'Local-Only Offscreen Bridge', desc: 'Heavy ONNX WASM & IndexedDB tasks run isolated from the UI thread to ensure zero UI jank.' },
    { title: 'Direct Gemini Nano Streaming', desc: 'UI taps directly into window.ai on-device session for instant sub-50ms token synthesis.' }
  ];

  guarantees.forEach((g, idx) => {
    const xPos = 0.8 + idx * (nodeW + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 4.85, w: nodeW, h: 1.65,
      rectRadius: 0.12,
      fill: { color: COLOR_SURFACE },
      line: { color: COLOR_BORDER, width: 1 }
    });
    slide.addText(g.title, {
      x: xPos + 0.15, y: 5.0, w: nodeW - 0.3, h: 0.35,
      fontSize: 10, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
    });
    slide.addText(g.desc, {
      x: xPos + 0.15, y: 5.38, w: nodeW - 0.3, h: 0.95,
      fontSize: 8.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 13
    });
  });
}

// ==================================================================================
// SLIDE 4: Comprehensive On-Device AI Suite + REAL UI SETUP SCREENSHOT
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };
  addSlideHeader(slide, 'Chrome Built-in AI Model Capabilities & On-Device Engine', 'AI Engine', 4);

  // Left 3 AI Pillars (x: 0.8 to 8.6, w: 2.5 each)
  const aiApis = [
    {
      num: '01',
      kicker: 'CORE REASONING',
      name: 'Prompt API (Gemini Nano)',
      metric: '3.2B',
      metricLabel: 'On-Device Parameters',
      desc: 'Powers conversational planning, DOM instruction parsing, autonomous reasoning, and direct tool execution with zero cloud latency.'
    },
    {
      num: '02',
      kicker: 'TEXT SYNTHESIS',
      name: 'Summarizer API',
      metric: '<100ms',
      metricLabel: 'Extraction Speed',
      desc: 'Performs extractive and abstractive document condensation with configurable formats: bullet-point lists, TLDR headlines, and detailed teases.'
    },
    {
      num: '03',
      kicker: 'IN-PLACE WRITING',
      name: 'Writer & Rewriter APIs',
      metric: '100%',
      metricLabel: 'Context Retention',
      desc: 'Drafts contextual replies in web forms, shifts tone (formal/casual), and tailors response length to exact requirements.'
    }
  ];

  const colW = 2.65;
  const gap = 0.22;
  aiApis.forEach((item, idx) => {
    const xPos = 0.8 + idx * (colW + gap);

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 1.6, w: colW, h: 4.9,
      rectRadius: 0.15,
      fill: { color: COLOR_CARD },
      line: { color: COLOR_BORDER, width: 1 }
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos + 0.18, y: 1.85, w: colW - 0.36, h: 0.28,
      rectRadius: 0.14,
      fill: { color: COLOR_PINE },
      line: { color: COLOR_MINT, width: 0.8 }
    });
    slide.addText(item.kicker, {
      x: xPos + 0.18, y: 1.85, w: colW - 0.36, h: 0.28,
      fontSize: 8, bold: true, color: COLOR_MINT,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });

    slide.addText(item.name, {
      x: xPos + 0.18, y: 2.3, w: colW - 0.36, h: 0.55,
      fontSize: 13, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
    });

    slide.addText(item.metric, {
      x: xPos + 0.18, y: 3.0, w: colW - 0.36, h: 0.6,
      fontSize: 32, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
    });
    slide.addText(item.metricLabel, {
      x: xPos + 0.18, y: 3.65, w: colW - 0.36, h: 0.25,
      fontSize: 9, bold: true, color: COLOR_CYAN, fontFace: 'Segoe UI'
    });

    slide.addShape(pptx.ShapeType.line, {
      x: xPos + 0.18, y: 4.1, w: colW - 0.36, h: 0,
      line: { color: COLOR_BORDER, width: 1 }
    });

    slide.addText(item.desc, {
      x: xPos + 0.18, y: 4.25, w: colW - 0.36, h: 2.0,
      fontSize: 9.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 15
    });
  });

  // Right Side: REAL SCREENSHOT MOCKUP (Local AI Engine Setup)
  addMockupFrame(slide, {
    x: 9.35, y: 1.6, w: 3.18, h: 4.9,
    title: 'pentone://ai-engine-setup',
    imagePath: SHOT_SETUP,
    imgW: 2.45,
    imgH: 4.25,
    caption: 'PROVEN ON-DEVICE MODEL PROVISIONING'
  });
}

// ==================================================================================
// SLIDE 5: Voice-First Streaming Pipeline Flowchart + REAL VOICE UI SCREENSHOT
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };
  addSlideHeader(slide, 'Real-Time Voice Streaming & Low-Latency Audio Pipeline', 'Voice Navigation', 5);

  slide.addText('End-to-End Auditory Feedback Loop with Zero-Cloud Streaming', {
    x: 0.8, y: 1.45, w: 8.5, h: 0.3,
    fontSize: 11.5, color: COLOR_CYAN, fontFace: 'Segoe UI'
  });

  // Top Left Flowchart: 4-Stage Horizontal Pipeline (x: 0.8, w: 8.35, y: 1.85, h: 2.4)
  const vStages = [
    { num: '01', title: 'Voice Trigger', latency: '<5ms PTT', desc: 'Spacebar keyhold or offline Porcupine ("Hey Pentone")' },
    { num: '02', title: 'Local Capture', latency: '<30ms ASR', desc: 'Client audio capture, 0kb audio streamed over network' },
    { num: '03', title: 'Gemini Nano', latency: '<50ms 1st Token', desc: 'Hardware-accelerated token streaming in real-time' },
    { num: '04', title: 'Chunked TTS', latency: '<100ms Playback', desc: 'Regex splitter feeds audio ahead of full completion' }
  ];

  const stW = 1.85;
  const stGap = 0.28;
  vStages.forEach((st, idx) => {
    const xPos = 0.8 + idx * (stW + stGap);

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 1.85, w: stW, h: 2.35,
      rectRadius: 0.12,
      fill: { color: COLOR_CARD },
      line: { color: idx === 2 ? COLOR_MINT : COLOR_BORDER, width: idx === 2 ? 1.4 : 1 }
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos + 0.12, y: 1.98, w: stW - 0.24, h: 0.24,
      rectRadius: 0.12,
      fill: { color: COLOR_PINE },
      line: { color: COLOR_MINT, width: 0.8 }
    });
    slide.addText(`STEP ${st.num}`, {
      x: xPos + 0.12, y: 1.98, w: stW - 0.24, h: 0.24,
      fontSize: 7.5, bold: true, color: COLOR_MINT,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });

    slide.addText(st.title, {
      x: xPos + 0.12, y: 2.28, w: stW - 0.24, h: 0.3,
      fontSize: 11, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
    });

    slide.addText(st.latency, {
      x: xPos + 0.12, y: 2.58, w: stW - 0.24, h: 0.22,
      fontSize: 8, bold: true, color: COLOR_GOLD, fontFace: 'Segoe UI'
    });

    slide.addText(st.desc, {
      x: xPos + 0.12, y: 2.85, w: stW - 0.24, h: 1.25,
      fontSize: 8.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 12
    });

    if (idx < 3) {
      addArrow(slide, xPos + stW + 0.04, 2.9, stGap - 0.08, 0.16);
    }
  });

  // Bottom Left: 2 Key Voice Engineering Cards (y: 4.4, h: 2.1)
  const vPillars = [
    {
      title: 'Push-to-Talk Spacebar Ergonomics',
      desc: 'Users hold the Spacebar to trigger voice commands instantly from any tab, bypassing tedious UI clicks and keyboard focus switching.'
    },
    {
      title: 'Continuous Voice Surfer Navigation',
      desc: 'Hands-free web navigation: Pentone overlays numbered pills on clickable elements so users can say "Click 4" to explore pages completely hands-free.'
    }
  ];

  const vColW = 4.05;
  const vGap = 0.25;
  vPillars.forEach((vp, idx) => {
    const xPos = 0.8 + idx * (vColW + vGap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 4.4, w: vColW, h: 2.1,
      rectRadius: 0.12,
      fill: { color: COLOR_SURFACE },
      line: { color: COLOR_BORDER, width: 1 }
    });
    slide.addText(vp.title, {
      x: xPos + 0.2, y: 4.58, w: vColW - 0.4, h: 0.32,
      fontSize: 11.5, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
    });
    slide.addText(vp.desc, {
      x: xPos + 0.2, y: 4.95, w: vColW - 0.4, h: 1.35,
      fontSize: 9.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 14
    });
  });

  // Right Side: REAL VOICE UI SCREENSHOT MOCKUP
  addMockupFrame(slide, {
    x: 9.35, y: 1.6, w: 3.18, h: 4.9,
    title: 'pentone://voice-surfer',
    imagePath: SHOT_VOICE,
    imgW: 2.45,
    imgH: 4.25,
    caption: 'LIVE VOICE ORB & SPEECH ENGINE'
  });
}

// ==================================================================================
// SLIDE 6: Local Semantic Vector Vault & Zero-Cloud RAG Flowchart
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };
  addSlideHeader(slide, 'Client-Side Neural Search & IndexedDB Vector Vault', 'Local RAG Pipeline', 6);

  slide.addText('Two-Phase Zero-Cloud Architecture: Ingestion Pipeline & Sub-15ms Similarity Search', {
    x: 0.8, y: 1.45, w: 11.733, h: 0.3,
    fontSize: 11.5, color: COLOR_CYAN, fontFace: 'Segoe UI'
  });

  // Top Row: Phase 1 Ingestion Pipeline (y: 1.85, h: 2.2)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8, y: 1.85, w: 11.733, h: 2.2,
    rectRadius: 0.14,
    fill: { color: COLOR_CARD },
    line: { color: COLOR_BORDER, width: 1.2 }
  });

  slide.addText('PHASE 1: CLIENT-SIDE INGESTION & EMBEDDING PIPELINE', {
    x: 1.1, y: 2.0, w: 6.0, h: 0.3,
    fontSize: 10, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
  });

  const ingestSteps = [
    { title: '1. Active Tab Content', tag: 'DOM / PDF / TXT', desc: 'Semantic article text & tables extracted in-browser' },
    { title: '2. Recursive Chunker', tag: '500 Chars / 100 Overlap', desc: 'Sliding context window maintains cross-sentence meaning' },
    { title: '3. ONNX WASM Engine', tag: 'all-MiniLM-L6-v2', desc: 'Executes local SIMD model producing 384-D dense floats' },
    { title: '4. IndexedDB Vault', tag: 'Local Browser Store', desc: 'Encrypted storage partitioned by domain & page hash' }
  ];

  const inW = 2.45;
  const inGap = 0.45;
  ingestSteps.forEach((st, idx) => {
    const xPos = 1.1 + idx * (inW + inGap);

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 2.4, w: inW, h: 1.4,
      rectRadius: 0.1,
      fill: { color: COLOR_SURFACE },
      line: { color: COLOR_BORDER, width: 1 }
    });
    slide.addText(st.title, {
      x: xPos + 0.1, y: 2.5, w: inW - 0.2, h: 0.3,
      fontSize: 10, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
    });
    slide.addText(st.tag, {
      x: xPos + 0.1, y: 2.8, w: inW - 0.2, h: 0.25,
      fontSize: 8, bold: true, color: COLOR_CYAN, fontFace: 'Segoe UI'
    });
    slide.addText(st.desc, {
      x: xPos + 0.1, y: 3.08, w: inW - 0.2, h: 0.65,
      fontSize: 8, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI'
    });

    if (idx < 3) {
      addArrow(slide, xPos + inW + 0.08, 3.0, inGap - 0.16, 0.16);
    }
  });

  // Bottom Row: Phase 2 Query & RAG Retrieval Flow (y: 4.3, h: 2.2)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8, y: 4.3, w: 11.733, h: 2.2,
    rectRadius: 0.14,
    fill: { color: COLOR_CARD },
    line: { color: COLOR_BORDER, width: 1.2 }
  });

  slide.addText('PHASE 2: REAL-TIME RETRIEVAL & CONTEXT-INJECTED SYNTHESIS', {
    x: 1.1, y: 4.45, w: 6.0, h: 0.3,
    fontSize: 10, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
  });

  const querySteps = [
    { title: '5. User Search / Voice', tag: 'Query Vectorization', desc: 'User question encoded to 384-D vector in <10ms' },
    { title: '6. SIMD Cosine Search', tag: '<15ms Dot Product', desc: 'Parallel dot product ranks top-k relevant text chunks' },
    { title: '7. Grounded Injection', tag: 'Context Injection', desc: 'High-relevance context injected into Gemini Nano prompt' },
    { title: '8. Factual Response', tag: '0KB Cloud Egress', desc: 'Accurate, hallucination-free answer with exact citations' }
  ];

  querySteps.forEach((st, idx) => {
    const xPos = 1.1 + idx * (inW + inGap);

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 4.85, w: inW, h: 1.4,
      rectRadius: 0.1,
      fill: { color: COLOR_SURFACE },
      line: { color: idx === 3 ? COLOR_MINT : COLOR_BORDER, width: idx === 3 ? 1.4 : 1 }
    });
    slide.addText(st.title, {
      x: xPos + 0.1, y: 4.95, w: inW - 0.2, h: 0.3,
      fontSize: 10, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
    });
    slide.addText(st.tag, {
      x: xPos + 0.1, y: 5.25, w: inW - 0.2, h: 0.25,
      fontSize: 8, bold: true, color: COLOR_CYAN, fontFace: 'Segoe UI'
    });
    slide.addText(st.desc, {
      x: xPos + 0.1, y: 5.53, w: inW - 0.2, h: 0.65,
      fontSize: 8, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI'
    });

    if (idx < 3) {
      addArrow(slide, xPos + inW + 0.08, 5.45, inGap - 0.16, 0.16);
    }
  });
}

// ==================================================================================
// SLIDE 7: Autonomous Web Navigation ReAct Loop + REAL CHAT SCREENSHOT
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };
  addSlideHeader(slide, 'ReAct Autonomous Reasoning & 30+ Precision DOM Tools', 'Agent Navigation', 7);

  slide.addText('Autonomous Observation-Reasoning-Action Loop with Self-Correcting Error Recovery', {
    x: 0.8, y: 1.45, w: 8.5, h: 0.3,
    fontSize: 11.5, color: COLOR_CYAN, fontFace: 'Segoe UI'
  });

  // Top Left: 4-Stage ReAct Flow (x: 0.8, w: 8.35, y: 1.85, h: 2.35)
  const rStages = [
    { step: '01', title: 'OBSERVE', sub: 'DOM Traversal', desc: 'Inspects DOM tree, element coordinates, and form inputs.' },
    { step: '02', title: 'REASON', sub: 'Gemini Nano', desc: 'Plans multi-step action & chooses optimal tool from 30+ library.' },
    { step: '03', title: 'EXECUTE', sub: 'Tool Dispatch', desc: 'Executes clickElement, smartType, coordinate click fallback.' },
    { step: '04', title: 'EVALUATE', sub: 'Mutation Check', desc: 'Verifies DOM state changes & self-corrects on errors.' }
  ];

  const rW = 1.85;
  const rGap = 0.28;
  rStages.forEach((st, idx) => {
    const xPos = 0.8 + idx * (rW + rGap);

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 1.85, w: rW, h: 2.35,
      rectRadius: 0.12,
      fill: { color: COLOR_CARD },
      line: { color: idx === 1 ? COLOR_MINT : COLOR_BORDER, width: idx === 1 ? 1.4 : 1 }
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos + 0.12, y: 1.98, w: rW - 0.24, h: 0.24,
      rectRadius: 0.12,
      fill: { color: COLOR_PINE },
      line: { color: COLOR_MINT, width: 0.8 }
    });
    slide.addText(`STAGE ${st.step}`, {
      x: xPos + 0.12, y: 1.98, w: rW - 0.24, h: 0.24,
      fontSize: 7.5, bold: true, color: COLOR_MINT,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });

    slide.addText(st.title, {
      x: xPos + 0.12, y: 2.28, w: rW - 0.24, h: 0.3,
      fontSize: 12, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
    });
    slide.addText(st.sub, {
      x: xPos + 0.12, y: 2.58, w: rW - 0.24, h: 0.22,
      fontSize: 8, color: COLOR_CYAN, fontFace: 'Segoe UI'
    });

    slide.addText(st.desc, {
      x: xPos + 0.12, y: 2.85, w: rW - 0.24, h: 1.25,
      fontSize: 8.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 12
    });

    if (idx < 3) {
      addArrow(slide, xPos + rW + 0.04, 2.9, rGap - 0.08, 0.16);
    }
  });

  // Bottom Left: 2 Tool Tier Summaries (y: 4.4, h: 2.1)
  const tiers = [
    {
      title: 'DOM MANIPULATION (12 TOOLS)',
      tools: 'clickElement, smartType, clearInput, selectDropdown, hoverElement, scrollIntoView',
      desc: 'Simulates human interaction with coordinate fallback and element visibility verification.'
    },
    {
      title: 'DATA EXTRACTION & TABS (18 TOOLS)',
      tools: 'extractTableData, harvestLinks, readDOMText, captureScreenshot, switchTab, createTab',
      desc: 'Parses complex tabular data, captures screenshots, and coordinates multi-tab research.'
    }
  ];

  const tColW = 4.05;
  const tGap = 0.25;
  tiers.forEach((tier, idx) => {
    const xPos = 0.8 + idx * (tColW + tGap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 4.4, w: tColW, h: 2.1,
      rectRadius: 0.12,
      fill: { color: COLOR_SURFACE },
      line: { color: COLOR_BORDER, width: 1 }
    });
    slide.addText(tier.title, {
      x: xPos + 0.2, y: 4.58, w: tColW - 0.4, h: 0.25,
      fontSize: 9, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
    });
    slide.addText(tier.tools, {
      x: xPos + 0.2, y: 4.88, w: tColW - 0.4, h: 0.45,
      fontSize: 8.5, bold: true, color: COLOR_TEXT, fontFace: 'Consolas'
    });
    slide.addText(tier.desc, {
      x: xPos + 0.2, y: 5.38, w: tColW - 0.4, h: 0.95,
      fontSize: 8.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 13
    });
  });

  // Right Side: REAL AGENT CHAT UI SCREENSHOT MOCKUP
  addMockupFrame(slide, {
    x: 9.35, y: 1.6, w: 3.18, h: 4.9,
    title: 'pentone://agent-chat',
    imagePath: SHOT_CHAT,
    imgW: 2.45,
    imgH: 4.25,
    caption: 'LIVE AGENT MULTI-TURN CHAT'
  });
}

// ==================================================================================
// SLIDE 8: Intelligent Form Autofill & Offline Resume Vault + REAL FORM AUTOFILL SCREENSHOT
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };
  addSlideHeader(slide, 'In-Browser Resume Extraction & One-Click Autofill', 'Form Autofill', 8);

  slide.addText('End-to-End Client-Side Parsing, Profile Extraction & DOM Form Injection Flow', {
    x: 0.8, y: 1.45, w: 11.733, h: 0.3,
    fontSize: 11.5, color: COLOR_CYAN, fontFace: 'Segoe UI'
  });

  // Top Section: 5-Stage Native Process Flowchart (y: 1.85, h: 2.3)
  const autoW = 2.05;
  const aGap = 0.37;
  const autofillFlow = [
    {
      step: 'STEP 01',
      title: 'Local Resume',
      tech: 'PDF / DOCX / TXT',
      desc: 'Selected locally by user. File never leaves browser storage.'
    },
    {
      step: 'STEP 02',
      title: 'WASM PDF Parser',
      tech: 'pdfjs-dist in Sandbox',
      desc: 'Parses text stream & font tokens in milliseconds.'
    },
    {
      step: 'STEP 03',
      title: 'Schema Extractor',
      tech: 'Chrome Gemini Nano',
      desc: 'Structures raw text into JSON: Work, Education, Skills.'
    },
    {
      step: 'STEP 04',
      title: 'Encrypted Vault',
      tech: 'IndexedDB Store',
      desc: 'Stored securely on client for reusable autofill sessions.'
    },
    {
      step: 'STEP 05',
      title: 'Form Dispatcher',
      tech: 'Event Synthesis',
      desc: 'Detects job inputs on Workday/LinkedIn & fills in 1 click.'
    }
  ];

  autofillFlow.forEach((st, idx) => {
    const xPos = 0.8 + idx * (autoW + aGap);

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 1.85, w: autoW, h: 2.25,
      rectRadius: 0.12,
      fill: { color: COLOR_CARD },
      line: { color: idx === 2 ? COLOR_MINT : COLOR_BORDER, width: idx === 2 ? 1.4 : 1 }
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos + 0.12, y: 1.98, w: autoW - 0.24, h: 0.24,
      rectRadius: 0.12,
      fill: { color: COLOR_PINE },
      line: { color: COLOR_MINT, width: 0.8 }
    });
    slide.addText(st.step, {
      x: xPos + 0.12, y: 1.98, w: autoW - 0.24, h: 0.24,
      fontSize: 7.5, bold: true, color: COLOR_MINT,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });

    slide.addText(st.title, {
      x: xPos + 0.12, y: 2.28, w: autoW - 0.24, h: 0.3,
      fontSize: 11, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
    });
    slide.addText(st.tech, {
      x: xPos + 0.12, y: 2.58, w: autoW - 0.24, h: 0.22,
      fontSize: 8, color: COLOR_GOLD, fontFace: 'Segoe UI'
    });
    slide.addText(st.desc, {
      x: xPos + 0.12, y: 2.82, w: autoW - 0.24, h: 1.15,
      fontSize: 8.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 12
    });

    if (idx < 4) {
      addArrow(slide, xPos + autoW + 0.06, 2.9, aGap - 0.12, 0.16);
    }
  });

  // Bottom Left: 2 Technical Detail Cards (x: 0.8, w: 5.8, y: 4.3, h: 2.2)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8, y: 4.3, w: 5.6, h: 2.2,
    rectRadius: 0.12,
    fill: { color: COLOR_SURFACE },
    line: { color: COLOR_BORDER, width: 1 }
  });
  slide.addText('Complete Data Sovereignty & Zero-Shot Schema Mapping', {
    x: 1.0, y: 4.45, w: 5.2, h: 0.3,
    fontSize: 11, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
  });
  slide.addText([
    { text: '• 100% Client-Side Privacy: ', options: { bold: true, color: COLOR_TEXT } },
    { text: 'Unlike commercial extensions that upload resumes to cloud parsers, Pentone keeps sensitive career data locked inside local browser IndexedDB.\n\n', options: { color: COLOR_TEXT_MUTED } },
    { text: '• Intelligent Form Injection: ', options: { bold: true, color: COLOR_TEXT } },
    { text: 'Automatically detects input elements, selects custom dropdowns and radio buttons, and synthesizes change events to pass frontend validations.', options: { color: COLOR_TEXT_MUTED } }
  ], {
    x: 1.0, y: 4.8, w: 5.2, h: 1.55,
    fontSize: 9, fontFace: 'Segoe UI', lineSpacing: 14
  });

  // Bottom Right: REAL FORM AUTOFILL SCREENSHOT MOCKUP
  addMockupFrame(slide, {
    x: 6.6, y: 4.3, w: 5.93, h: 2.2,
    title: 'https://roboform.com/test-form (Auto-Filled by Pentone)',
    imagePath: SHOT_AUTOFILL,
    imgW: 3.55,
    imgH: 1.55,
    caption: 'ACTUAL AUTO-FILLED WEB FORM WITH MINT OUTLINES'
  });
}

// ==================================================================================
// SLIDE 9: Production Hardening, Splash Optimization & Security + REAL IN-PAGE REWRITE MOCKUP
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };
  addSlideHeader(slide, 'Production Hardening, Splash Optimization & Security', 'System Hardening', 9);

  // Left 2 Pillars (x: 0.8, w: 7.2)
  const pillars = [
    {
      kicker: 'SECURITY SUITE',
      title: 'Zero-Trust Sandboxing',
      badge: 'CSP LEVEL 3',
      points: [
        'Content Security Policy Level 3 strictly forbids remote code execution (eval, new Function, external scripts).',
        'Strict tab origin isolation prevents prompt injection and cross-site scripting vulnerabilities.',
        'Zero outbound network requests during AI execution guarantees 100% compliance with GDPR/HIPAA standards.'
      ]
    },
    {
      kicker: 'PERFORMANCE UX',
      title: '0ms Frame-0 Splash Loader',
      badge: 'MICRO-OPTIMIZED',
      points: [
        'Eliminated the irritating side-panel blank white flash during Chrome extension launch.',
        'Inline critical CSS & dark basalt SVG spinner renders synchronously on Frame 0 before JavaScript loads.',
        'Seamless React 18 hydration replaces the splash screen with zero layout shift or visual jitter.'
      ]
    }
  ];

  const pWidth = 3.5;
  const pGap = 0.25;
  pillars.forEach((p, idx) => {
    const xPos = 0.8 + idx * (pWidth + pGap);

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 1.6, w: pWidth, h: 4.9,
      rectRadius: 0.15,
      fill: { color: COLOR_CARD },
      line: { color: COLOR_BORDER, width: 1.2 }
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos + 0.22, y: 1.85, w: pWidth - 0.44, h: 0.28,
      rectRadius: 0.14,
      fill: { color: COLOR_PINE },
      line: { color: COLOR_MINT, width: 0.8 }
    });
    slide.addText(p.kicker, {
      x: xPos + 0.22, y: 1.85, w: pWidth - 0.44, h: 0.28,
      fontSize: 8, bold: true, color: COLOR_MINT,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });

    slide.addText(p.title, {
      x: xPos + 0.22, y: 2.25, w: pWidth - 0.44, h: 0.4,
      fontSize: 14, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
    });

    slide.addText(`[ ${p.badge} ]`, {
      x: xPos + 0.22, y: 2.68, w: pWidth - 0.44, h: 0.25,
      fontSize: 9, bold: true, color: COLOR_CYAN, fontFace: 'Segoe UI'
    });

    slide.addShape(pptx.ShapeType.line, {
      x: xPos + 0.22, y: 3.0, w: pWidth - 0.44, h: 0,
      line: { color: COLOR_BORDER, width: 1 }
    });

    let yPt = 3.15;
    p.points.forEach(pt => {
      slide.addText('• ' + pt, {
        x: xPos + 0.22, y: yPt, w: pWidth - 0.44, h: 1.05,
        fontSize: 9.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 14
      });
      yPt += 1.1;
    });
  });

  // Right Side: REAL IN-PAGE REWRITE TOOL SCREENSHOT MOCKUP
  addMockupFrame(slide, {
    x: 8.3, y: 1.6, w: 4.23, h: 2.7,
    title: 'pentone://in-page-rewrite',
    imagePath: SHOT_REWRITE,
    imgW: 3.85,
    imgH: 1.95,
    caption: 'FLOATING IN-PAGE REWRITE COMPONENT'
  });

  // Right Bottom: Minimalist Editorial UI Callout Box
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.3, y: 4.45, w: 4.23, h: 2.05,
    rectRadius: 0.12,
    fill: { color: COLOR_SURFACE },
    line: { color: COLOR_BORDER, width: 1 }
  });
  slide.addText('Editorial Minimalist UI Design System', {
    x: 8.5, y: 4.62, w: 3.8, h: 0.28,
    fontSize: 11, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
  });
  slide.addText('Bespoke dark basalt aesthetic built for prolonged developer productivity. Features tactile audio feedback, Spacebar PTT ergonomics, and instant reactive light/dark theme synchronization.', {
    x: 8.5, y: 4.95, w: 3.8, h: 1.35,
    fontSize: 9.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 14
  });
}

// ==================================================================================
// SLIDE 10: Conclusion, Technical Impact & Q&A
// Presenter: Raghav Mishra | B.Tech CSE | LNCT University
// ==================================================================================
{
  const slide = pptx.addSlide();
  slide.background = { color: COLOR_BG };
  addSlideHeader(slide, 'Project Conclusion & Technical Impact', 'Conclusion', 10);

  slide.addShape(pptx.ShapeType.ellipse, {
    x: 8.5, y: 1.2, w: 5.0, h: 5.0,
    fill: { color: '003F36', transparency: 75 }
  });

  // Left Column: Key Achievements (x: 0.8, w: 6.8, h: 4.9)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.8, y: 1.6, w: 6.8, h: 4.9,
    rectRadius: 0.15,
    fill: { color: COLOR_CARD },
    line: { color: COLOR_BORDER_MINT, width: 1.5 }
  });

  slide.addText('Key Engineering Achievements', {
    x: 1.1, y: 1.85, w: 6.2, h: 0.35,
    fontSize: 15, bold: true, color: COLOR_MINT, fontFace: 'Segoe UI'
  });

  const achievements = [
    {
      num: '01',
      title: 'True Local-First Autonomous Browser Agent',
      desc: 'Proved that state-of-the-art web automation, multi-step ReAct reasoning, and tab control run smoothly 100% on-device with zero server reliance.'
    },
    {
      num: '02',
      title: 'Sub-50ms Latency via Chrome Gemini Nano',
      desc: 'Eliminated cloud API round-trips with instant streaming token generation, low-latency summarization, and seamless speech chunking.'
    },
    {
      num: '03',
      title: 'Production-Grade Privacy & Zero Telemetry',
      desc: 'Guarantees total confidentiality for sensitive tasks (banking, health records, credentials, job applications) with zero external network traffic.'
    },
    {
      num: '04',
      title: 'Voice-First Multimodal Accessibility',
      desc: 'Push-to-talk Spacebar control, offline Porcupine wake-word detection, and streaming TTS enable effortless hands-free web exploration.'
    }
  ];

  let yAch = 2.3;
  achievements.forEach(ach => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 1.1, y: yAch, w: 0.65, h: 0.28,
      rectRadius: 0.14,
      fill: { color: COLOR_PINE },
      line: { color: COLOR_MINT, width: 0.8 }
    });
    slide.addText(ach.num, {
      x: 1.1, y: yAch, w: 0.65, h: 0.28,
      fontSize: 8.5, bold: true, color: COLOR_MINT,
      align: 'center', valign: 'middle', fontFace: 'Segoe UI'
    });

    slide.addText(ach.title, {
      x: 1.85, y: yAch, w: 5.4, h: 0.28,
      fontSize: 11, bold: true, color: COLOR_TEXT, fontFace: 'Segoe UI'
    });
    slide.addText(ach.desc, {
      x: 1.85, y: yAch + 0.3, w: 5.4, h: 0.65,
      fontSize: 9.5, color: COLOR_TEXT_MUTED, fontFace: 'Segoe UI', lineSpacing: 14
    });
    yAch += 1.05;
  });

  // Right Column: Presenter Credentials & Q&A Box (x: 7.9, w: 4.6, h: 4.9)
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7.9, y: 1.6, w: 4.6, h: 4.9,
    rectRadius: 0.15,
    fill: { color: COLOR_CARD_ELEVATED },
    line: { color: COLOR_MINT, width: 1.5 }
  });

  slide.addText('Thank You!', {
    x: 8.1, y: 1.95, w: 4.2, h: 0.55,
    fontSize: 28, bold: true, color: COLOR_MINT,
    align: 'center', fontFace: 'Segoe UI'
  });
  slide.addText('Questions & Live Demonstration', {
    x: 8.1, y: 2.5, w: 4.2, h: 0.35,
    fontSize: 13, color: COLOR_TEXT,
    align: 'center', fontFace: 'Segoe UI'
  });

  slide.addShape(pptx.ShapeType.line, {
    x: 8.6, y: 3.0, w: 3.2, h: 0,
    line: { color: COLOR_BORDER, width: 1 }
  });

  slide.addText('PROJECT ARCHITECT & DEVELOPER', {
    x: 8.1, y: 3.2, w: 4.2, h: 0.25,
    fontSize: 8.5, bold: true, color: COLOR_CYAN,
    align: 'center', fontFace: 'Segoe UI'
  });

  slide.addText('Raghav Mishra', {
    x: 8.1, y: 3.5, w: 4.2, h: 0.45,
    fontSize: 22, bold: true, color: COLOR_TEXT,
    align: 'center', fontFace: 'Segoe UI'
  });

  slide.addText('B.Tech CSE', {
    x: 8.1, y: 4.0, w: 4.2, h: 0.35,
    fontSize: 15, bold: true, color: COLOR_CYAN,
    align: 'center', fontFace: 'Segoe UI'
  });
  slide.addText('Computer Science & Engineering', {
    x: 8.1, y: 4.35, w: 4.2, h: 0.25,
    fontSize: 10.5, color: COLOR_TEXT_MUTED,
    align: 'center', fontFace: 'Segoe UI'
  });

  slide.addText('LNCT University', {
    x: 8.1, y: 4.65, w: 4.2, h: 0.38,
    fontSize: 16, bold: true, color: COLOR_TEXT,
    align: 'center', fontFace: 'Segoe UI'
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 8.6, y: 5.25, w: 3.2, h: 0.44,
    rectRadius: 0.22,
    fill: { color: COLOR_PINE },
    line: { color: COLOR_MINT, width: 1 }
  });
  slide.addText('github.com/Raghavv1206/Pentone', {
    x: 8.6, y: 5.25, w: 3.2, h: 0.44,
    fontSize: 9.5, bold: true, color: COLOR_TEXT,
    align: 'center', valign: 'middle', fontFace: 'Segoe UI'
  });
}

// Auto-selects first writable file path
let targetPath = '';
let version = 1;
while (true) {
  const p = path.join(__dirname, '..', version === 1 ? 'Pentone_Presentation.pptx' : `Pentone_Presentation_v${version}.pptx`);
  try {
    if (fs.existsSync(p)) {
      const fd = fs.openSync(p, 'r+');
      fs.closeSync(fd);
    }
    targetPath = p;
    break;
  } catch (e) {
    version++;
  }
}

pptx.writeFile({ fileName: targetPath })
  .then(() => {
    console.log(`[PPTX] Successfully generated 10-slide PowerPoint presentation with vector flowcharts AND authentic product screenshots at: ${targetPath}`);
  })
  .catch(err => {
    console.error('[PPTX] Error writing presentation:', err);
    process.exit(1);
  });
