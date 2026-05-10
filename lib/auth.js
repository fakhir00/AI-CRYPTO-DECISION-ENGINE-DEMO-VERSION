import { Clerk } from '@clerk/clerk-js';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  const msg = '⚠️ NEXUS Error: VITE_CLERK_PUBLISHABLE_KEY is missing in environment variables.';
  console.error(msg);
  // Only alert if we are in the browser
  if (typeof window !== 'undefined') {
    setTimeout(() => alert(msg), 1000);
  }
}

export const clerk = new Clerk(clerkPublishableKey || 'missing_key');

export async function setupAuth(onAuthChange) {
  try {
    if (!clerkPublishableKey) return onAuthChange(false, null);
    
    await clerk.load();
    console.log('✅ Clerk loaded successfully. Auth state:', !!clerk.user);

    if (clerk.user) {
      onAuthChange(true, clerk.user);
    } else {
      onAuthChange(false, null);
    }

    clerk.addListener(({ user }) => {
      onAuthChange(!!user, user);
    });
  } catch (err) {
    console.error('❌ Clerk failed to load:', err);
  }
}

export function openSignIn() {
  clerk.openSignIn();
}

export function openUserProfile() {
  clerk.openUserProfile();
}

export async function logout() {
  await clerk.signOut();
}
