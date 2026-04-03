'use client';

import React, { useEffect, useState } from 'react';
import { getMeetings, startMeeting } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Plus, Calendar, Clock, ArrowRight, User } from 'lucide-react';
import { motion } from 'framer-motion';

export default function MeetingsDashboard() {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchMeetings();
  }, []);

  const fetchMeetings = async () => {
    try {
      const data = await getMeetings();
      setMeetings(data);
    } catch (error) {
      console.error('Error fetching meetings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartMeeting = async () => {
    try {
      const { session_id } = await startMeeting();
      router.push(`/meetings/${session_id}`);
    } catch (error) {
      console.error('Error starting meeting:', error);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 p-8 pt-16">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-end mb-12">
          <div>
            <h1 className="text-4xl font-bold tracking-tight mb-2">Meetings</h1>
            <p className="text-zinc-400">View and manage your past meeting insights.</p>
          </div>
          <button
            onClick={handleStartMeeting}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 transition-colors text-white px-6 py-3 rounded-full font-medium shadow-lg shadow-blue-900/20"
          >
            <Plus size={20} />
            Start Meeting
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : meetings.length === 0 ? (
          <div className="glass rounded-3xl p-12 text-center flex flex-col items-center justify-center">
            <div className="bg-zinc-900 p-4 rounded-2xl mb-4 text-zinc-500">
              <Calendar size={32} />
            </div>
            <h3 className="text-xl font-medium mb-2">No meetings found</h3>
            <p className="text-zinc-400 mb-6 max-w-sm mx-auto">
              You haven't recorded any meetings yet. Start one to see the magic happen!
            </p>
            <button
              onClick={handleStartMeeting}
              className="text-blue-500 hover:text-blue-400 font-medium transition-colors"
            >
              Start your first meeting now
            </button>
          </div>
        ) : (
          <div className="meeting-grid">
            {meetings.map((meeting, index) => (
              <motion.div
                key={meeting.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => router.push(`/meetings/${meeting.id}`)}
                className="glass rounded-3xl p-6 hover:bg-white/[0.05] transition-all cursor-pointer group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-2 rounded-xl border ${meeting.is_active ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-green-500/10 border-green-500/20 text-green-500'}`}>
                    <Clock size={18} />
                  </div>
                  {meeting.is_active && (
                    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-red-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse"></span>
                      Live
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-semibold mb-1 group-hover:text-blue-400 transition-colors">
                  {meeting.title || 'Untitled Meeting'}
                </h3>
                <div className="flex items-center gap-4 text-zinc-500 text-sm mb-6">
                  <span className="flex items-center gap-1">
                    <Calendar size={14} />
                    {new Date(meeting.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex -space-x-2">
                    <div className="h-8 w-8 rounded-full bg-zinc-800 border-2 border-black flex items-center justify-center text-xs">
                      <User size={12} />
                    </div>
                  </div>
                  <div className="h-10 w-10 rounded-full border border-white/10 flex items-center justify-center group-hover:bg-white group-hover:text-black transition-all">
                    <ArrowRight size={18} />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
