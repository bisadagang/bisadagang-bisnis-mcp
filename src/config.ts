export interface Config {
  apiKey: string;
  apiSecret: string;
  environment: 'sandbox' | 'production';
  allowProductionTransactions: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const environment = env.BISADAGANG_ENV ?? 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('BISADAGANG_ENV harus bernilai sandbox atau production.');
  }

  const apiKey = env.BISADAGANG_API_KEY;
  const apiSecret = env.BISADAGANG_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('Atur BISADAGANG_API_KEY dan BISADAGANG_API_SECRET.');
  }

  const prefix = environment === 'sandbox' ? 'bdk_test_' : 'bdk_live_';
  if (!apiKey.startsWith(prefix) || apiKey.length === prefix.length) {
    throw new Error('Awalan BISADAGANG_API_KEY harus sesuai dengan BISADAGANG_ENV.');
  }

  return {
    apiKey,
    apiSecret,
    environment,
    allowProductionTransactions: env.BISADAGANG_ALLOW_PRODUCTION_TRANSACTIONS === 'true',
  };
}
