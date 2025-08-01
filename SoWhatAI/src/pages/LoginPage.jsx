import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

const LoginPage = ({ onLogin, onNavigate }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            setError(error.message);
        } else {
            onLogin(data.user);
        }
        setIsSubmitting(false);
    };
    
    const handleSignUp = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
            setError(error.message);
        } else {
            onLogin(data.user);
        }
        setIsSubmitting(false);
    };

    return (
         <div className="bg-gray-900/50 backdrop-blur-lg border border-gray-700/50 rounded-lg shadow-2xl p-8 max-w-md mx-auto">
            <button onClick={() => onNavigate('home')} className="text-sm font-medium text-[#13BBAF] hover:text-teal-400 mb-4">&larr; Back to home</button>
            <h2 className="text-2xl font-bold text-white text-center">Welcome</h2>
            <form className="mt-6 space-y-6">
                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-300">Email address</label>
                    <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]" />
                </div>
                 <div>
                    <label htmlFor="password" className="block text-sm font-medium text-gray-300">Password</label>
                    <input type="password" id="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white shadow-sm focus:outline-none focus:ring-[#13BBAF] focus:border-[#13BBAF]" />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <div className="flex items-center justify-end space-x-4">
                    <button onClick={handleLogin} disabled={isSubmitting} className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-500">
                        {isSubmitting ? 'Signing in...' : 'Sign In'}
                    </button>
                    <button onClick={handleSignUp} disabled={isSubmitting} className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-[#13BBAF] hover:bg-teal-600">
                        {isSubmitting ? 'Signing up...' : 'Sign Up'}
                    </button>
                </div>
            </form>
         </div>
    );
};

export default LoginPage;

