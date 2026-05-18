import React from 'react';
import {NavLink, Outlet} from 'react-router-dom';

const navItems = [
  {to: '/dashboard', label: 'Dashboard'},
  {to: '/providers', label: 'Providers'},
  {to: '/proxy', label: 'Proxy'},
  {to: '/models', label: 'Models'},
  {to: '/sessions', label: 'Sessions'},
  {to: '/runs', label: 'Runs'},
  {to: '/network', label: 'Network'},
  {to: '/logs', label: 'Logs'},
  {to: '/settings', label: 'Settings'}
];

export default function Layout() {
  return (
    <div className="app-root">
      <header className="header" role="navigation" aria-label="Primary">
        <div className="brand">Luna Proxy</div>
        <nav className="nav">
          <ul className="nav-list">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={({isActive}) => isActive ? 'active nav-link' : 'nav-link'}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="main">
        <header className="topbar">
          <h1 className="page-title">Luna Proxy Manager</h1>
        </header>
        <main className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
