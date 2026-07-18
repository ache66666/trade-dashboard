'use strict';

const AUTH_REQUIRED = Object.freeze({ error:'Authentication required' });
const AUTH_UNAVAILABLE = Object.freeze({ error:'Authentication service unavailable' });

function bearerToken(header) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(header || '').trim());
  return match ? match[1] : null;
}

function publicUser(user) {
  return {
    id:String(user.id),
    email:typeof user.email === 'string' ? user.email : ''
  };
}

async function verifyAccessToken(token, options) {
  const config = options.config;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 10000;
  let timer;
  let controller;
  let response;

  if (!config.authConfigured || !config.supabaseUrl || !config.supabasePublishableKey) {
    const error = new Error('Authentication is not configured');
    error.code = 'AUTH_UNAVAILABLE';
    throw error;
  }
  if (typeof fetchImpl !== 'function') {
    const error = new Error('Authentication transport is unavailable');
    error.code = 'AUTH_UNAVAILABLE';
    throw error;
  }

  controller = new AbortController();
  timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, {
      method:'GET',
      headers:{
        apikey:config.supabasePublishableKey,
        Authorization:`Bearer ${token}`
      },
      signal:controller.signal
    });
  } catch (cause) {
    const error = new Error('Authentication verification failed');
    error.code = 'AUTH_UNAVAILABLE';
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    const error = new Error('Authentication service rejected verification');
    error.code = 'AUTH_UNAVAILABLE';
    throw error;
  }

  try {
    const user = await response.json();
    return user && user.id ? publicUser(user) : null;
  } catch (cause) {
    const error = new Error('Authentication response was invalid');
    error.code = 'AUTH_UNAVAILABLE';
    throw error;
  }
}

async function requireAuth(req, res, options) {
  const token = bearerToken(req.headers.authorization);
  if (!token) {
    options.sendJson(res, 401, AUTH_REQUIRED);
    return null;
  }

  try {
    const user = await verifyAccessToken(token, options);
    if (!user) {
      options.sendJson(res, 401, AUTH_REQUIRED);
      return null;
    }
    req.user = user;
    req.auth = Object.freeze({ accessToken:token });
    return user;
  } catch (error) {
    if (options.logger) options.logger.warn('Authentication verification is temporarily unavailable');
    options.sendJson(res, 503, AUTH_UNAVAILABLE);
    return null;
  }
}

module.exports = {
  AUTH_REQUIRED,
  AUTH_UNAVAILABLE,
  bearerToken,
  publicUser,
  verifyAccessToken,
  requireAuth
};
