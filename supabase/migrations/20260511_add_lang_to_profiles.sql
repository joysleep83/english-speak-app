-- Add lang column to profiles table
-- Run this in the Supabase Dashboard > SQL Editor
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lang text DEFAULT 'en';
