import React from 'react';
import {NavLink, Outlet} from 'react-router-dom';
import {useI18n} from '../i18n';

const navItems = [
  {to: '/dashboard', labelKey: 'nav.dashboard'},
  {to: '/providers', labelKey: 'nav.providers'},
  {to: '/proxy', labelKey: 'nav.proxy'},
  {to: '/models', labelKey: 'nav.models'},
  {to: '/sessions', labelKey: 'nav.sessions'},
  {to: '/runs', labelKey: 'nav.runs'},
  {to: '/network', labelKey: 'nav.network'},
  {to: '/logs', labelKey: 'nav.logs'},
  {to: '/settings', labelKey: 'nav.settings'}
];

export default function Layout() {
  const {t} = useI18n();

  return (
    <div className="app-root">
      <header className="header" role="navigation" aria-label="Primary">
        <div className="brand">Luna Proxy</div>
        <nav className="nav">
          <ul className="nav-list">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={({isActive}) => isActive ? 'active nav-link' : 'nav-link'}>
                  {t(item.labelKey)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <div className="main">
        <header className="topbar">
          <h1 className="page-title">{t('app.title')}</h1>
        </header>
        <main className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
