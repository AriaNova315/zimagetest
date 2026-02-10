const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxy && process.env.NODE_ENV !== 'production') {
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
    console.log(`[Proxy] Global fetch proxy set to: ${proxy}`);
  } catch (e) {
    console.warn('[Proxy] Failed to set up proxy:', e.message);
  }
}
