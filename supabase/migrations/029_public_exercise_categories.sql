-- APeX · Let logged-out clients read exercise_categories
--
-- The sign-up flow's "What's your main sport?" step (SignUpScreen.tsx /
-- SportPicker.tsx, migration 028) runs before the user has an account, but
-- migration 026 only let authenticated users read this table — so every
-- sign-up got an empty sport list and silently defaulted to general_fitness.
-- The rows are non-sensitive reference data (three sport names), so anyone
-- may read them. Writes stay locked down: there is still no INSERT/UPDATE/
-- DELETE policy.

DROP POLICY IF EXISTS "authenticated users read exercise categories" ON public.exercise_categories;
DROP POLICY IF EXISTS "anyone reads exercise categories" ON public.exercise_categories;

CREATE POLICY "anyone reads exercise categories" ON public.exercise_categories
  FOR SELECT TO anon, authenticated USING (true);
