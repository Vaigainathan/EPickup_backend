function httpError(status, code, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (extra) {
    Object.assign(error, extra);
  }
  return error;
}

module.exports = {
  httpError
};
