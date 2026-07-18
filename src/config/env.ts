import 'dotenv/config';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  mongoUri: process.env.MONGODB_URI ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  whatsappToken: process.env.WHATSAPP_TOKEN ?? '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
  whatsappTestOverrideNumber: process.env.WHATSAPP_TEST_OVERRIDE_NUMBER ?? '',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? '',
};

export const assertRuntimeEnv = () => {
  required('MONGODB_URI');
  required('JWT_SECRET');
};
