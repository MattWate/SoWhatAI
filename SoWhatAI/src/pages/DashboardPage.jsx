import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient.js';
import VersionBadge from '../components/VersionBadge';

async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, project_name, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

const DashboardPage = ({ user }) => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const rows = await listProjects();
        setProjects(rows);
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-white">Welcome back, {user?.email.split('@')[0]}</h2>
        <p className="text-gray-400 mt-1">Ready to find the "So What?" in your data?</p>
      </div>

      <button
        onClick={() => navigate('/app')}
        className="w-full md:w-auto inline-flex items-center justify-center px-8 py-3 rounded-md shadow-sm text-black bg-[#EDC8FF] hover:bg-purple-200 transition-colors transform hover:scale-105"
      >
        + Create New Project
      </button>

      <hr className="border-gray-700/50" />

      <div>
        <h3 className="text-2xl font-semibold text-white mb-4">Your Projects</h3>
        {err && <p className="text-red-400 text-sm mb-3">{err}</p>}
        {loading ? (
          <div className="text-gray-400">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg">
            <h4 className="mt-4 text-lg font-semibold text-white">No projects yet</h4>
            <p className="mt-1 text-sm text-gray-400">Click "Create New Project" to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map(p => (
              <div key={p.id} className="p-4 bg-gray-800/60 border border-gray-700 rounded-lg">
                <div className="text-white font-semibold">{p.project_name || 'Untitled Project'}</div>
                <div className="text-gray-500 text-sm">{new Date(p.created_at).toLocaleString()}</div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => navigate(`/app/${p.id}`)}
                    className="px-3 py-1 bg-teal-600 hover:bg-teal-500 rounded text-white text-sm"
                  >
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-4 flex justify-end">
        <VersionBadge />
      </div>
    </div>
  );
};

export default DashboardPage;
