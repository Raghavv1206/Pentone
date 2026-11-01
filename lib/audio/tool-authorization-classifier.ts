/**
 * Tool Authorization Classifier & Security Policy
 * 
 * Classifies every browser tool by capability requirements (READ_ONLY vs MUTATING)
 * and evaluates high-impact/destructive sensitivity.
 * 
 * Security Principles:
 * 1. UNCLASSIFIED or UNKNOWN tools MUST FAIL CLOSED (denied authorization).
 * 2. READ-ONLY tools require at least READ_ONLY_INFORMATIONAL capability scope.
 * 3. MUTATING tools strictly require EXECUTE_MUTATING_ACTIONS capability scope.
 * 4. High-impact / financial / destructive actions require explicit user confirmation;
 *    biometric speaker verification alone is strictly insufficient.
 */

import type { VoiceCapabilityScope } from './voice-authorization-types';

export type ToolActionType = 'READ_ONLY' | 'MUTATING';

export interface HighImpactCheckResult {
  readonly isHighImpact: boolean;
  readonly reason?: string;
}

export interface ToolClassification {
  readonly name: string;
  readonly actionType: ToolActionType;
  readonly requiredScope: VoiceCapabilityScope;
  readonly checkHighImpact?: (parameters: any) => HighImpactCheckResult;
}

// Regex patterns for sensitive DOM actions
const SENSITIVE_CLICK_TERMS = /\b(buy|purchase|checkout|pay|transfer|wire|delete account|remove account|format|confirm payment|place order)\b/i;
const SENSITIVE_INPUT_FIELDS = /\b(password|passwd|card|creditcard|cc_number|cvv|cvc|ssn|pin|routing_number|bank_account)\b/i;
const SENSITIVE_URL_PATTERNS = /(banking|checkout|payment|paypal\.com|stripe\.com|wire|crypto|login\/reset|delete-account)/i;

/**
 * Checks if openTab parameters target sensitive, financial, or internal resources.
 */
function checkOpenTabImpact(params: any): HighImpactCheckResult {
  const url = String(params?.url || '').trim();
  if (SENSITIVE_URL_PATTERNS.test(url)) {
    return {
      isHighImpact: true,
      reason: `Navigation targets sensitive or financial endpoint: ${url}`,
    };
  }
  return { isHighImpact: false };
}

/**
 * Checks if closeTab parameters target active tab without explicit index/id.
 */
function checkCloseTabImpact(params: any): HighImpactCheckResult {
  if (params?.closeActive === true && params?.index === undefined && params?.id === undefined) {
    return {
      isHighImpact: true,
      reason: 'Closing active browser tab requires confirmation',
    };
  }
  return { isHighImpact: false };
}

/**
 * Checks if clickElement parameters target high-impact / payment / destructive buttons.
 */
function checkClickElementImpact(params: any): HighImpactCheckResult {
  const targetDesc = String(params?.description || params?.label || params?.text || params?.selector || '').trim();
  if (SENSITIVE_CLICK_TERMS.test(targetDesc)) {
    return {
      isHighImpact: true,
      reason: `Click targets high-impact or financial action: ${targetDesc}`,
    };
  }
  return { isHighImpact: false };
}

/**
 * Checks if fillInput parameters attempt to input credentials, financial data, or sensitive tokens.
 */
function checkFillInputImpact(params: any): HighImpactCheckResult {
  const targetField = String(params?.fieldName || params?.name || params?.label || params?.selector || '').trim();
  const value = String(params?.value || '').trim();

  if (SENSITIVE_INPUT_FIELDS.test(targetField)) {
    return {
      isHighImpact: true,
      reason: `Input targets sensitive field: ${targetField}`,
    };
  }

  // Detect credit card number patterns (13 to 19 digits)
  if (/\b(?:\d[ -]*?){13,19}\b/.test(value)) {
    return {
      isHighImpact: true,
      reason: 'Input value contains potential payment card number',
    };
  }

  return { isHighImpact: false };
}

/**
 * Complete classification mapping for all registered browser tools in Pentone.
 */
export const TOOL_CLASSIFICATIONS: Readonly<Record<string, ToolClassification>> = Object.freeze({
  // Read-only / Informational Tools
  think: {
    name: 'think',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  getPageTitle: {
    name: 'getPageTitle',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  captureScreenshot: {
    name: 'captureScreenshot',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  getAccessibilitySnapshot: {
    name: 'getAccessibilitySnapshot',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  findElements: {
    name: 'findElements',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  listen: {
    name: 'listen',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  captureAudio: {
    name: 'captureAudio',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  writeContent: {
    name: 'writeContent',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  summarizePage: {
    name: 'summarizePage',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  getMemories: {
    name: 'getMemories',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  translateText: {
    name: 'translateText',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  detectLanguage: {
    name: 'detectLanguage',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  captureCurrentPage: {
    name: 'captureCurrentPage',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  searchVault: {
    name: 'searchVault',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  getVaultStats: {
    name: 'getVaultStats',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  getPlaybook: {
    name: 'getPlaybook',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },
  getTabs: {
    name: 'getTabs',
    actionType: 'READ_ONLY',
    requiredScope: 'READ_ONLY_INFORMATIONAL',
  },

  // Mutating Tools
  openTab: {
    name: 'openTab',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    checkHighImpact: checkOpenTabImpact,
  },
  closeTab: {
    name: 'closeTab',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    checkHighImpact: checkCloseTabImpact,
  },
  clickElement: {
    name: 'clickElement',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    checkHighImpact: checkClickElementImpact,
  },
  fillInput: {
    name: 'fillInput',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
    checkHighImpact: checkFillInputImpact,
  },
  scrollUp: {
    name: 'scrollUp',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
  },
  scrollDown: {
    name: 'scrollDown',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
  },
  pressKey: {
    name: 'pressKey',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
  },
  highlightSelector: {
    name: 'highlightSelector',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
  },
  highlightText: {
    name: 'highlightText',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
  },
  storeMemory: {
    name: 'storeMemory',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
  },
  switchTab: {
    name: 'switchTab',
    actionType: 'MUTATING',
    requiredScope: 'EXECUTE_MUTATING_ACTIONS',
  },
});

/**
 * Retrieves the classification for a tool. Returns null if unclassified (fails closed).
 */
export function classifyTool(toolName: string): ToolClassification | null {
  if (!toolName || typeof toolName !== 'string') {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(TOOL_CLASSIFICATIONS, toolName)) {
    return null;
  }
  return TOOL_CLASSIFICATIONS[toolName] ?? null;
}

/**
 * Checks whether a specific tool execution request constitutes a high-impact action.
 */
export function evaluateHighImpact(toolName: string, parameters: any): HighImpactCheckResult {
  const classification = classifyTool(toolName);
  if (!classification) {
    return { isHighImpact: true, reason: `Unclassified tool: ${toolName}` };
  }
  if (classification.checkHighImpact) {
    return classification.checkHighImpact(parameters);
  }
  return { isHighImpact: false };
}
