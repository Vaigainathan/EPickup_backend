const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const DOCUMENT_FIELDS = [
  { name: 'gst', maxCount: 1 },
  { name: 'fssai', maxCount: 1 },
  { name: 'gstDocument', maxCount: 1 },
  { name: 'fssaiDocument', maxCount: 1 },
  { name: 'gstFile', maxCount: 1 },
  { name: 'fssaiFile', maxCount: 1 },
  { name: 'document', maxCount: 1 }
];

function firstFile(files, names) {
  if (!files) {
    return undefined;
  }
  for (const name of names) {
    if (files[name]?.[0]) {
      return files[name][0];
    }
  }
  return undefined;
}

function pickDocumentFiles(req) {
  const files = req.files || {};
  const documentType = String(req.body?.documentType || '').toLowerCase();
  const single = firstFile(files, ['document']);

  let gst = firstFile(files, ['gst', 'gstDocument', 'gstFile']);
  let fssai = firstFile(files, ['fssai', 'fssaiDocument', 'fssaiFile']);

  if (single && documentType === 'gst' && !gst) {
    gst = single;
  }
  if (single && documentType === 'fssai' && !fssai) {
    fssai = single;
  }

  return { gst, fssai };
}

function handleDocumentUpload(req, res, next) {
  upload.fields(DOCUMENT_FIELDS)(req, res, (err) => {
    if (err) {
      const isLimit = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        error: {
          code: isLimit ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
          message: isLimit ? 'File must be 5MB or smaller' : 'Failed to upload document'
        }
      });
    }
    next();
  });
}

module.exports = {
  DOCUMENT_FIELDS,
  pickDocumentFiles,
  handleDocumentUpload
};
