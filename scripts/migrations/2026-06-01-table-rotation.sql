-- Add rotation (degrees) to restaurant_tables so long/rectangular tables can be
-- turned 90° (vertical) on the floor plan. 0 = horizontal (default).
alter table public.restaurant_tables
  add column if not exists rotation integer not null default 0;
