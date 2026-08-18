-- Add Supervisor role with same full access as Admin
ALTER TYPE public.cargo_usuario ADD VALUE IF NOT EXISTS 'Supervisor';
