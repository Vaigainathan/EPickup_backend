const notificationService = require('../notificationService');
const { NOTIFICATION_TEMPLATES } = require('../notificationTemplates');

/** Candidate SHOP category template keys for onboarding lifecycle pushes. */
const SHOP_ONBOARDING_PUSH_CANDIDATES = {
  approve: ['ONBOARDING_APPROVED', 'APPROVAL_APPROVED', 'SHOP_APPROVED'],
  reject: ['ONBOARDING_REJECTED', 'APPROVAL_REJECTED', 'SHOP_REJECTED']
};

function safeGetShopTemplate(templateKey) {
  const categoryTemplates = NOTIFICATION_TEMPLATES.SHOP;
  if (!categoryTemplates || !templateKey) {
    return null;
  }
  const template = categoryTemplates[templateKey];
  return template || null;
}

function findShopTemplate(typeKey) {
  for (const key of SHOP_ONBOARDING_PUSH_CANDIDATES[typeKey] || []) {
    const template = safeGetShopTemplate(key);
    if (template) {
      return { key, template };
    }
  }
  return null;
}

/**
 * Send shop push only when a template exists (no invented types).
 * @returns {Promise<{ sent: boolean, templateKey?: string, reason?: string }>}
 */
async function trySendShopOnboardingPush(shopUserId, action, variables = {}) {
  const found = findShopTemplate(action);
  if (!found) {
    return {
      sent: false,
      reason: 'no_shop_onboarding_template',
      searched: SHOP_ONBOARDING_PUSH_CANDIDATES[action]
    };
  }

  const result = await notificationService.sendTemplateNotification(
    shopUserId,
    'SHOP',
    found.key,
    variables
  );

  return { sent: result?.success !== false, templateKey: found.key, delivery: result };
}

module.exports = {
  SHOP_ONBOARDING_PUSH_CANDIDATES,
  safeGetShopTemplate,
  findShopTemplate,
  trySendShopOnboardingPush
};
