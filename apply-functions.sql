-- Apply all SQL functions
-- Run this with: psql $DATABASE_URL -f apply-functions.sql

\echo 'Applying SQL functions...'
\echo ''

\echo '1. Applying get_bill_by_id...'
\i prisma/functions/get_bill_by_id.plpgsql

\echo '2. Applying get_bills...'
\i prisma/functions/get_bills.plpgsql

\echo '3. Applying get_bills_and_orders...'
\i prisma/functions/get_bills_and_orders.plpgsql

\echo '4. Applying get_executive_order_by_id...'
\i prisma/functions/get_executive_order_by_id.plpgsql

\echo '5. Applying get_executive_orders...'
\i prisma/functions/get_executive_orders.plpgsql

\echo ''
\echo 'All functions applied successfully!'
