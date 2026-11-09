/**
 * Prevent conditional GET (304) on trip bootstrap responses while keeping JSON bodies fresh.
 * Clears precondition headers so Express ETag logic cannot short-circuit the response.
 */
function prepareNoStoreResponse(req, res) {
  if (req && req.headers) {
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
  }
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0'
  });
}

module.exports = {
  prepareNoStoreResponse
};
