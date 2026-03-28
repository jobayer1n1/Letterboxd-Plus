// utils/url.js
function getBaseUrl(req) {
  // Handle Cloudflare
  let protocol = 'http';
  
  if (req.headers['cf-visitor']) {
    try {
      const cfVisitor = JSON.parse(req.headers['cf-visitor']);
      protocol = cfVisitor.scheme || 'https';
    } catch (e) {
      console.error('Failed to parse cf-visitor:', e);
    }
  } else if (req.headers['x-forwarded-proto']) {
    protocol = req.headers['x-forwarded-proto'];
  } else if (req.protocol) {
    protocol = req.protocol;
  }
  
  // Get host
  let host = req.headers['x-forwarded-host'] || req.headers.host;
  
  // Remove port if it's standard HTTP/HTTPS
  if ((protocol === 'http' && host.endsWith(':80')) ||
      (protocol === 'https' && host.endsWith(':443'))) {
    host = host.split(':')[0];
  }
  
  return `${protocol}://${host}`;
}

module.exports = { getBaseUrl, };