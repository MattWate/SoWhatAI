import { createClient } from '@supabase/supabase-js'

// --- Supabase Configuration ---
// These are your project's unique credentials.
const supabaseUrl = 'https://wopdpporlylygxyvpene.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvcGRwcG9ybHlseWd4eXZwZW5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMwOTg0MjIsImV4cCI6MjA2ODY3NDQyMn0.ub5LP_93NcC6wkJbkQWkJ6oBLTKrUNJIiZJosgA9c6Q'

// --- Initialize the Supabase Client ---
// This creates a single, reusable connection to your database.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
