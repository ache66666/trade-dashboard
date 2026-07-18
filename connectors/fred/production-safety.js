'use strict';

const PROJECT_REF_PATTERN = /^[a-z0-9]{8,64}$/i;
const WRITE_CONFIRMATION = 'production-fred-mvp';

function databaseTarget(value) {
  let parsed;
  let projectRef = '';
  try { parsed = new URL(String(value || '')); } catch (error) {
    return { valid:false, projectRef:'', database:'', host:'' };
  }
  const directHost = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
  const poolerUser = /^postgres\.([a-z0-9]+)$/i.exec(decodeURIComponent(parsed.username || ''));
  const poolerHost = /\.pooler\.supabase\.com$/i.test(parsed.hostname);
  if (directHost) projectRef = directHost[1].toLowerCase();
  if (poolerUser && poolerHost) projectRef = poolerUser[1].toLowerCase();
  return {
    valid:(parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
      Boolean(directHost || (poolerUser && poolerHost)) &&
      !/^(?:localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(parsed.hostname),
    projectRef,
    database:decodeURIComponent(parsed.pathname.replace(/^\//, '') || ''),
    host:parsed.hostname
  };
}

function projectRefFromSupabaseUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
    const cleanPath = parsed.pathname === '' || parsed.pathname === '/';
    return match && parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      cleanPath && !parsed.search && !parsed.hash ? match[1].toLowerCase() : '';
  } catch (error) {
    return '';
  }
}

function maskProjectRef(value) {
  const ref = String(value || '');
  return ref.length > 8 ? `${ref.slice(0, 4)}...${ref.slice(-4)}` : 'configured';
}

function assertProductionSafety(environment, options = {}) {
  const appEnv = String(environment.APP_ENV || '').trim().toLowerCase();
  const allowRef = String(environment.PRODUCTION_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
  const stagingRef = String(environment.STAGING_SUPABASE_PROJECT_REF || '').trim().toLowerCase();
  const target = databaseTarget(environment.DATABASE_URL);
  const supabaseRef = projectRefFromSupabaseUrl(environment.SUPABASE_URL);
  const writeRequested = options.writeRequested === true;

  if (appEnv !== 'production') throw new Error('FRED connector refused: APP_ENV must be production.');
  if (!PROJECT_REF_PATTERN.test(allowRef)) throw new Error('FRED connector refused: Production allow-list is required.');
  if (!PROJECT_REF_PATTERN.test(stagingRef)) throw new Error('FRED connector refused: Staging deny-list is required.');
  if (!target.valid || !target.projectRef || !target.database) {
    throw new Error('FRED connector refused: database target cannot be verified.');
  }
  if (!supabaseRef || target.projectRef !== allowRef || supabaseRef !== allowRef) {
    throw new Error('FRED connector refused: target does not match the Production allow-list.');
  }
  if (target.projectRef === stagingRef) throw new Error('FRED connector refused: target matches Staging.');
  if (writeRequested && options.confirmation !== WRITE_CONFIRMATION) {
    throw new Error('FRED connector refused: explicit write confirmation is required.');
  }

  return {
    environment:'production',
    project:maskProjectRef(target.projectRef),
    database:target.database,
    mode:writeRequested ? 'apply' : 'dry-run'
  };
}

function productionPublicUrl(environment) {
  const value = String(environment.PRODUCTION_PUBLIC_URL || environment.RENDER_EXTERNAL_URL || '').trim();
  let parsed;
  try { parsed = new URL(value); } catch (error) {
    throw new Error('FRED connector refused: Production readback URL is required.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash ||
      /^(?:localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(parsed.hostname)) {
    throw new Error('FRED connector refused: Production readback URL is invalid.');
  }
  return parsed.origin;
}

module.exports = {
  WRITE_CONFIRMATION,
  assertProductionSafety,
  databaseTarget,
  productionPublicUrl,
  projectRefFromSupabaseUrl
};
