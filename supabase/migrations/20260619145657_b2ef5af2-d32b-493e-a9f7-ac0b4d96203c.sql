CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = _user_id AND cargo::text IN ('Admin', 'Supervisor')
  )
$function$;
