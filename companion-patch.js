/**
 * companion-patch.js — DISABLED v3.0
 * Companion (BF/GF) personas removed from CrackAI.
 * Kept as no-op stub for backward compatibility.
 */
(function() {
  'use strict';
  window.openCompanionGateModal = function() { if (typeof openPremiumModal === 'function') openPremiumModal(); };
  window.activateCompanion = function() {};
  window.activateCompanionYearly = function() {};
  window.initCompanion3DAvatar = function() {};
  window.isCompanionUnlocked = function() { return false; };
  console.info('[CompanionPatch] v3.0 — companion personas removed');
})();