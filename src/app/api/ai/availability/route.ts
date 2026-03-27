import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
     const { searchParams } = new URL(request.url);
     const tenant_id = searchParams.get('tenant_id');
     const date = searchParams.get('date');
     const party_size = searchParams.get('party_size');

     if (!tenant_id || !date || !party_size) {
        return NextResponse.json({ success: false, error: "Missing required params" }, { status: 400 });
     }

     const supabase = createServiceRoleClient();

     // Fetch existing reservations for the date
     const { data: reservations, error } = await supabase
        .from('reservations')
        .select('time, party_size')
        .eq('tenant_id', tenant_id)
        .eq('date', date)
        .in('status', ['confirmed', 'seated']);

     if (error) throw error;

     // Mock capacity logic
     const MAX_CAPACITY_PER_SLOT = 40;

     // Slots array representing available times
     const slots = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'];

     const availability = slots.map(time => {
        const reservationsAtTime = (reservations || []).filter((r: any) => r.time === time);
        const paxBooked = reservationsAtTime.reduce((sum: number, r: any) => sum + (r.party_size || 0), 0);
        const paxRequested = parseInt(party_size);

        return {
           time,
           available: (paxBooked + paxRequested) <= MAX_CAPACITY_PER_SLOT,
           remaining_capacity: Math.max(0, MAX_CAPACITY_PER_SLOT - paxBooked)
        };
     });

     return NextResponse.json({
        success: true,
        date,
        party_size: parseInt(party_size),
        availability
     });

  } catch (error: any) {
     console.error("Availability Check Error:", error);
     return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
