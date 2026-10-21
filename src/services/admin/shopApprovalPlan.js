function verifiedNameFromBank(bank) {
  const name = bank && bank.upiNameVerification && typeof bank.upiNameVerification.verifiedName === 'string'
    ? bank.upiNameVerification.verifiedName.trim()
    : '';
  return name;
}

function planShopApproval({ approvalStatus, bank }) {
  const verifiedName = verifiedNameFromBank(bank);
  if (!verifiedName) {
    return {
      ok: false,
      message: 'Shop bank.upiNameVerification.verifiedName is required before approval.'
    };
  }

  if (approvalStatus === 'approved') {
    return { ok: true, noop: true };
  }

  return {
    ok: true,
    noop: false,
    verifiedName
  };
}

module.exports = {
  verifiedNameFromBank,
  planShopApproval
};
