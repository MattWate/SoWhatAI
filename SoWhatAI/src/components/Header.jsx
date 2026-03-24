import React from 'react';
import { useNavigate } from 'react-router-dom';

const Header = ({ user, onLogout }) => {
  const navigate = useNavigate();

  return (
    <header className="bg-transparent sticky top-0 z-50">
      <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
        <h1
          className="text-2xl font-bold leading-tight text-white cursor-pointer"
          onClick={() => navigate(user ? '/dashboard' : '/')}
        >
          So What <span className="text-[#EDC8FF]">AI</span>
        </h1>
        <div className="flex items-center space-x-4">
          {user ? (
            <button onClick={onLogout} className="text-sm font-medium text-gray-300 hover:text-white">
              Logout
            </button>
          ) : (
            <>
              <button onClick={() => navigate('/login')} className="text-sm font-medium text-gray-300 hover:text-white">
                Log In
              </button>
              <button
                onClick={() => navigate('/login')}
                className="px-4 py-2 text-sm font-medium text-black bg-[#EDC8FF] rounded-md hover:bg-purple-200 transition-colors"
              >
                Start Free Trial
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
