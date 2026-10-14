function thumbPathForOriginal(originalPath) {
  if (typeof originalPath !== 'string' || originalPath.trim() === '') {
    return null;
  }
  const trimmed = originalPath.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0) {
    return `${trimmed}_thumb.jpg`;
  }
  const base = trimmed.slice(0, lastDot);
  return `${base}_thumb.jpg`;
}

module.exports = {
  thumbPathForOriginal
};
