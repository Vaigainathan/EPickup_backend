function trimRegisteredName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function verifiedNameFrom(bank) {
  const name = bank && bank.upiNameVerification && typeof bank.upiNameVerification.verifiedName === 'string'
    ? bank.upiNameVerification.verifiedName.trim()
    : '';
  return name;
}

function isVerified(bank) {
  return verifiedNameFrom(bank) !== '';
}

function mergeBankAfterUpiRegisteredName(existingBank, upiRegisteredName) {
  const bank = existingBank && typeof existingBank === 'object' ? { ...existingBank } : {};
  const previous = trimRegisteredName(bank.upiRegisteredName);
  bank.upiRegisteredName = upiRegisteredName;
  if (upiRegisteredName !== previous) {
    delete bank.upiNameVerification;
  }
  return bank;
}

function mergeBankAfterUpiVerify(existingBank, normalizedUpiId, upiVerifiedAt) {
  const bank = existingBank && typeof existingBank === 'object' ? { ...existingBank } : {};
  const previousUpi = typeof bank.upiId === 'string' ? bank.upiId : '';
  bank.upiId = normalizedUpiId;
  bank.upiVerified = true;
  bank.upiVerifiedAt = upiVerifiedAt;
  if (normalizedUpiId !== previousUpi) {
    delete bank.upiNameVerification;
  }
  return bank;
}

function mergeBankAfterSaveDetails(existingBank, savedFields) {
  const bank = {
    accountHolderName: savedFields.accountHolderName,
    bankName: savedFields.bankName,
    accountNumberEncrypted: savedFields.accountNumberEncrypted,
    accountNumberLast4: savedFields.accountNumberLast4,
    ifsc: savedFields.ifsc,
    upiId: savedFields.upiId,
    upiVerified: true,
    upiVerifiedAt: savedFields.upiVerifiedAt
  };

  const registered = trimRegisteredName(existingBank && existingBank.upiRegisteredName);
  if (registered) {
    bank.upiRegisteredName = registered;
  }

  const previousUpi = existingBank && typeof existingBank.upiId === 'string' ? existingBank.upiId : '';
  if (savedFields.upiId === previousUpi && existingBank && existingBank.upiNameVerification) {
    bank.upiNameVerification = existingBank.upiNameVerification;
  }

  return bank;
}

module.exports = {
  trimRegisteredName,
  verifiedNameFrom,
  isVerified,
  mergeBankAfterUpiRegisteredName,
  mergeBankAfterUpiVerify,
  mergeBankAfterSaveDetails
};
