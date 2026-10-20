-- Run in the Supabase SQL Editor as the project owner.
-- Links the existing staff@gmail.com Auth account to the staff portal profile.
DO $$
DECLARE
    staff_user_id UUID;
    staff_email TEXT;
BEGIN
    SELECT id, email
    INTO staff_user_id, staff_email
    FROM auth.users
    WHERE lower(email) = lower('staff@gmail.com');

    IF staff_user_id IS NULL THEN
        RAISE EXCEPTION 'No Supabase Auth user exists for staff@gmail.com. Create or confirm the Auth user first.';
    END IF;

    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (staff_user_id, staff_email, 'pangcubila', 'staff')
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = 'staff';
END;
$$;
