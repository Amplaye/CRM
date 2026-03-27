import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';

// Strict schema validation is assumed in a massive production app (e.g. Zod), 
// but we will do manual validation here for simplicity.

export async function GET(request: Request) {
  try {
     const { searchParams } = new URL(request.url);
     const tenant_id = searchParams.get('tenant_id');
     const date = searchParams.get('date');
     const party_size = searchParams.get('party_size');

     if (!tenant_id || !date || !party_size) {
        return NextResponse.json({ success: false, error: "Missing required params" }, { status: 400 });
     }

     // In a real restaurant system, this would calculate:
     // Total capacity - Sum(Reservations for that date/time)
     // For this AI integration demo, we'll mock a simple response block.

     // Fetch existing reservations for the date
     const reservationsSnapshot = await db.collection('reservations')
        .where('tenant_id', '==', tenant_id)
        .where('date', '==', date)
        .where('status', 'in', ['confirmed', 'seated'])
        .get();

     // Mock capacity logic
     const MAX_CAPACITY_PER_SLOT = 40; 
     
     // Slots array representing available times
     const slots = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
     
     const availability = slots.map(time => {
        const reservationsAtTime = reservationsSnapshot.docs.filter(d => d.data().time === time);
        const paxBooked = reservationsAtTime.reduce((sum, doc) => sum + (doc.data().party_size || 0), 0);
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
