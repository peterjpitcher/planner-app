// Environment configuration checker
// Run with: node check-env.js

console.log('🔍 Checking Environment Configuration...\n');

// Check required environment variables
const requiredVars = [
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY'
];

let hasErrors = false;

requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (!value) {
    console.error(`❌ ${varName} is not set`);
    hasErrors = true;
  } else {
    // Mask sensitive values
    let displayValue = value;
    if (varName === 'NEXTAUTH_SECRET' || varName.includes('KEY')) {
      displayValue = value.substring(0, 4) + '...' + value.substring(value.length - 4);
    }
    console.log(`✅ ${varName}: ${displayValue}`);
  }
});

console.log('\n📋 Configuration Checks:');

// Check NEXTAUTH_URL format
const nextAuthUrl = process.env.NEXTAUTH_URL;
if (nextAuthUrl) {
  if (nextAuthUrl.endsWith('/')) {
    console.error('❌ NEXTAUTH_URL should not have a trailing slash');
    hasErrors = true;
  } else {
    console.log('✅ NEXTAUTH_URL format is correct (no trailing slash)');
  }
  
  if (!nextAuthUrl.startsWith('http://') && !nextAuthUrl.startsWith('https://')) {
    console.error('❌ NEXTAUTH_URL must start with http:// or https://');
    hasErrors = true;
  } else {
    console.log('✅ NEXTAUTH_URL has valid protocol');
  }
}

// Check Supabase URL format
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl && !supabaseUrl.includes('.supabase.co')) {
  console.warn('⚠️  NEXT_PUBLIC_SUPABASE_URL doesn\'t look like a Supabase URL');
}

// Check if running locally or in production
console.log('\n🌐 Environment:');
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`Port: ${process.env.PORT || '3000'}`);

if (hasErrors) {
  console.log('\n❌ Configuration has errors. Please fix them before proceeding.');
  process.exit(1);
} else {
  console.log('\n✅ All environment variables are configured!');
  console.log('\n💡 Next steps:');
  console.log('1. If running locally, ensure your dev server is using the correct port');
  console.log('2. If deployed, ensure these values match in your hosting platform');
  console.log('3. Test login with valid Supabase credentials');
}