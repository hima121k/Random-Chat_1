import { useState, useEffect } from 'react';
import { Shield, Zap, Users, Volume2, Trash2, Flag, CheckCircle, XCircle, UserX, Ban, MessageSquare, Star, Search, Ticket, Tag, Plus, Calendar } from 'lucide-react';
import {
  getUserRole, type Role, type Report, type BannedUser, type BanAppeal,
  getAllAdmins, grantAdmin, revokeAdmin,
  publishAnnouncement, clearAnnouncement,
  subscribeToPlatformMetrics, subscribeToPendingReports, subscribeToAllReports,
  subscribeToBannedUsers, dismissReport, actionReportBan,
  manualBanUser, unbanUser, clearAllReports, deleteReport, deleteAllReportsForUser,
  subscribeToAppeals, approveAppeal, denyAppeal,
  subscribeToProUsers, updateUserSubscription, updateUserSubscriptionByEmail,
  subscribeToCoupons, createCoupon, deleteCoupon, type Coupon,
} from '../services/admin';
import { Timestamp } from 'firebase/firestore';
import { auth } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

type Tab = 'reports' | 'allreports' | 'banned' | 'appeals' | 'announcements' | 'admins' | 'subscriptions' | 'coupons';

export default function AdminDashboard() {
  const [role, setRole] = useState<Role | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('reports');
  const [admins, setAdmins] = useState<string[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [metrics, setMetrics] = useState({ activeChats: 0, waitingUsers: 0 });
  const [reports, setReports] = useState<Report[]>([]);
  const [allReports, setAllReports] = useState<Report[]>([]);
  const [bannedUsers, setBannedUsers] = useState<BannedUser[]>([]);
  const [appeals, setAppeals] = useState<BanAppeal[]>([]);
  const [proUsers, setProUsers] = useState<{ uid: string; email?: string; name?: string; isPro: boolean; status?: string }[]>([]);
  const [proSearchUid, setProSearchUid] = useState('');
  const [proSearchEmail, setProSearchEmail] = useState('');
  const [proSearchType, setProSearchType] = useState<'uid' | 'email'>('uid');
  const [coupons, setCoupons] = useState<Coupon[]>([]);

  // New Coupon Form
  const [cpCode, setCpCode] = useState('');
  const [cpDiscount, setCpDiscount] = useState('10');
  const [cpExpiry, setCpExpiry] = useState('');
  const [cpActive, setCpActive] = useState(true);

  // Manual ban form
  const [banUserId, setBanUserId] = useState('');
  const [banEmail, setBanEmail] = useState('');
  const [banName, setBanName] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banPermanent, setBanPermanent] = useState(false);

  const fetchAdmins = async () => {
    try { setAdmins(await getAllAdmins()); } catch (err) { console.error(err); }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userRole = await getUserRole(user.email);
        setRole(userRole);
        if (userRole === 'owner') fetchAdmins();
      }
    });

    const unsubMetrics = subscribeToPlatformMetrics(setMetrics);
    const unsubReports = subscribeToPendingReports(setReports);
    const unsubAllReports = subscribeToAllReports(setAllReports);
    const unsubBanned = subscribeToBannedUsers(setBannedUsers);
    const unsubAppeals = subscribeToAppeals(setAppeals);
    const unsubPro = subscribeToProUsers(setProUsers);
    const unsubCoupons = subscribeToCoupons(setCoupons);

    return () => {
      unsub();
      unsubMetrics();
      unsubReports();
      unsubAllReports();
      unsubBanned();
      unsubAppeals();
      unsubPro();
      unsubCoupons();
    };
  }, []);

  const showMsg = (msg: string, isError = false) => {
    if (isError) setError(msg); else setSuccess(msg);
    setTimeout(() => { setError(null); setSuccess(null); }, 3500);
  };

  // ── Announcement handlers ──
  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announcement.trim()) return;
    setIsLoading(true);
    try { await publishAnnouncement(announcement.trim()); showMsg('Announcement published!'); setAnnouncement(''); }
    catch (err: unknown) { showMsg((err as Error).message || 'Failed', true); }
    finally { setIsLoading(false); }
  };
  const handleClear = async () => {
    setIsLoading(true);
    try { await clearAnnouncement(); showMsg('Announcement cleared!'); }
    catch (err: unknown) { showMsg((err as Error).message || 'Failed', true); }
    finally { setIsLoading(false); }
  };

  // ── Report handlers ──
  const handleDismiss = async (reportId: string) => {
    try { await dismissReport(reportId); showMsg('Report dismissed.'); }
    catch (err: unknown) { showMsg((err as Error).message || 'Failed', true); }
  };
  const handleBanFromReport = async (report: Report, permanent: boolean) => {
    if (!confirm(`${permanent ? 'Permanently' : 'Temporarily (7 days)'} ban ${report.reportedName}?`)) return;
    try {
      await actionReportBan(report.id, report.reportedId, report.reportedName, report.reportedEmail || '', permanent);
      showMsg(`${report.reportedName} has been banned.`);
    } catch (err: any) { showMsg(err.message || 'Failed', true); }
  };

  // ── Manual ban ──
  const handleManualBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!banUserId.trim() || !banReason.trim()) { showMsg('User ID and reason are required.', true); return; }
    setIsLoading(true);
    try {
      await manualBanUser(banUserId.trim(), banEmail.trim(), banName.trim(), banReason.trim(), banPermanent);
      showMsg(`User banned successfully.`);
      setBanUserId(''); setBanEmail(''); setBanName(''); setBanReason(''); setBanPermanent(false);
    } catch (err: any) { showMsg(err.message || 'Failed', true); }
    finally { setIsLoading(false); }
  };


  // ── Unban ──
  const handleUnban = async (userId: string, name: string) => {
    if (!confirm(`Unban ${name || userId}?`)) return;
    try { await unbanUser(userId); showMsg(`${name || userId} has been unbanned.`); }
    catch (err: unknown) { showMsg((err as Error).message || 'Failed', true); }
  };

  // ── Clear all reports ──
  const handleClearAllReports = async () => {
    if (!confirm('⚠️ Delete ALL reports permanently? This cannot be undone.')) return;
    setIsLoading(true);
    try {
      const count = await clearAllReports();
      showMsg(`Deleted ${count} report(s) successfully.`);
    } catch (err: any) { showMsg(err.message || 'Failed', true); }
    finally { setIsLoading(false); }
  };

  // ── Delete single report ──
  const handleDeleteReport = async (reportId: string) => {
    if (!confirm('Delete this report permanently?')) return;
    try { await deleteReport(reportId); showMsg('Report deleted.'); }
    catch (err: unknown) { showMsg((err as Error).message || 'Failed', true); }
  };

  // ── Delete all reports for one user ──
  const handleDeleteUserReports = async (uid: string, name: string) => {
    if (!confirm(`Delete ALL reports for ${name}? This cannot be undone.`)) return;
    try {
      const count = await deleteAllReportsForUser(uid);
      showMsg(`Deleted ${count} report(s) for ${name}.`);
    } catch (err: any) { showMsg(err.message || 'Failed', true); }
  };

  // ── Admin management ──
  const handleGrantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail.trim()) return;
    setIsLoading(true);
    try { await grantAdmin(newAdminEmail.trim()); showMsg(`Admin granted to ${newAdminEmail}.`); setNewAdminEmail(''); fetchAdmins(); }
    catch (err: unknown) { showMsg((err as Error).message || 'Failed', true); }
    finally { setIsLoading(false); }
  };
  const handleRevokeAdmin = async (email: string) => {
    if (!confirm(`Revoke admin rights from ${email}?`)) return;
    try { await revokeAdmin(email); showMsg(`Admin revoked from ${email}.`); fetchAdmins(); }
    catch (err: unknown) { showMsg((err as Error).message || 'Failed', true); }
  };

  const handleTogglePro = async (uid: string, currentStatus: boolean, email?: string) => {
    const action = currentStatus ? 'Revoke' : 'Grant';
    if (!confirm(`${action} Pro status for ${email || uid}?`)) return;
    try {
      await updateUserSubscription(uid, !currentStatus);
      showMsg(`Pro status ${currentStatus ? 'revoked' : 'granted'}.`);
    } catch (err: unknown) {
      showMsg((err as Error).message || 'Failed', true);
    }
  };

  const handleManualProGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = proSearchType === 'uid' ? proSearchUid.trim() : proSearchEmail.trim();
    if (!target) return;
    setIsLoading(true);
    try {
      if (proSearchType === 'uid') {
        await updateUserSubscription(target, true);
      } else {
        await updateUserSubscriptionByEmail(target, true);
      }
      showMsg(`Pro status granted manually to ${target}.`);
      setProSearchUid(''); setProSearchEmail('');
    } catch (err: unknown) {
      showMsg((err as Error).message || 'Failed', true);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Coupon Management ──
  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpCode.trim()) return;
    setIsLoading(true);
    try {
      const expiresAt = cpExpiry ? Timestamp.fromDate(new Date(cpExpiry)) : null;
      await createCoupon({
        code: cpCode.trim(),
        discountPercent: parseInt(cpDiscount, 10),
        expiresAt,
        active: cpActive,
      });
      showMsg('Coupon created successfully!');
      setCpCode(''); setCpExpiry('');
    } catch (err: unknown) {
      showMsg((err as Error).message || 'Failed', true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCoupon = async (id: string, code: string) => {
    if (!confirm(`Delete coupon ${code}?`)) return;
    try {
      await deleteCoupon(id);
      showMsg('Coupon deleted.');
    } catch (err: unknown) {
      showMsg((err as Error).message || 'Failed', true);
    }
  };

  const formatDate = (ts: Timestamp | Date | null) => {
    if (!ts) return 'Unknown';
    const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // Compute grouped reports for All Reports tab
  const groupedReports = allReports.reduce<Record<string, { name: string; email: string; reports: Report[] }>>((acc, r) => {
    const key = r.reportedId;
    if (!acc[key]) acc[key] = { name: r.reportedName, email: r.reportedEmail || '', reports: [] };
    acc[key].reports.push(r);
    return acc;
  }, {});
  const sortedReportGroups = Object.entries(groupedReports).sort((a, b) => b[1].reports.length - a[1].reports.length);

  const STATUS_STYLE: Record<string, string> = {
    pending:  'text-amber-400 bg-amber-500/10 border-amber-500/30',
    actioned: 'text-red-400 bg-red-500/10 border-red-500/30',
    dismissed:'text-rc-muted bg-rc-surface border-rc-border',
  };

  if (!role) return (
    <div className="min-h-screen bg-rc-bg flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rc-accent" />
    </div>
  );

  const pendingAppeals = appeals.filter(a => a.status === 'pending').length;
  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    ...(role === 'owner' ? [{ id: 'admins' as Tab, label: 'Admins', icon: <Users size={16} /> }] : []),
    { id: 'announcements', label: 'Announcements', icon: <Volume2 size={16} /> },
    { id: 'reports', label: 'Report Queue', icon: <Flag size={16} />, badge: reports.length },
    { id: 'appeals', label: 'Appeals', icon: <MessageSquare size={16} />, badge: pendingAppeals },
    { id: 'allreports', label: 'All Reports', icon: <Flag size={16} />, badge: allReports.length },
    { id: 'banned', label: 'Banned Users', icon: <Ban size={16} />, badge: bannedUsers.length },
    ...(role === 'owner' ? [
      { id: 'subscriptions' as Tab, label: 'Pro Users', icon: <Star size={16} />, badge: proUsers.length },
      { id: 'coupons' as Tab, label: 'Coupons & Offers', icon: <Ticket size={16} />, badge: coupons.length }
    ] : []),
  ];

  return (
    <div className="min-h-screen bg-rc-bg text-rc-text p-4 md:p-10">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-rc-border pb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-rc-accent/20 flex items-center justify-center border border-rc-accent/50 shadow-glowSm">
              <Shield className="text-rc-accentGlow" size={24} />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">System Command</h1>
              <p className="text-rc-muted mt-0.5 text-sm">
                Role: <span className={`font-bold ${role === 'owner' ? 'text-amber-400' : 'text-blue-400'}`}>{role.toUpperCase()}</span>
              </p>
            </div>
          </div>
          {/* Metrics */}
          <div className="flex gap-4">
            <div className="bg-rc-surface border border-rc-border rounded-xl px-4 py-2 text-center">
              <p className="text-xl font-bold text-white">{metrics.waitingUsers + metrics.activeChats * 2}</p>
              <p className="text-[10px] text-rc-muted uppercase tracking-wider">Active Users</p>
            </div>
            <div className="bg-rc-surface border border-rc-border rounded-xl px-4 py-2 text-center">
              <p className="text-xl font-bold text-indigo-400">{metrics.activeChats}</p>
              <p className="text-[10px] text-rc-muted uppercase tracking-wider">Live Chats</p>
            </div>
          </div>
        </div>

        {/* Notifications */}
        {error && <div className="bg-red-500/10 border border-red-500/40 text-red-400 p-3 rounded-xl text-sm">{error}</div>}
        {success && <div className="bg-green-500/10 border border-green-500/40 text-green-400 p-3 rounded-xl text-sm">{success}</div>}

        {/* Tabs */}
        <div className="flex gap-2 border-b border-rc-border overflow-x-auto pb-px">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-xl whitespace-nowrap transition-all border-b-2 ${
                activeTab === tab.id
                  ? 'border-rc-accent text-rc-accentGlow bg-rc-accent/10'
                  : 'border-transparent text-rc-muted hover:text-rc-text'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── REPORT QUEUE TAB ── */}
        {activeTab === 'reports' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Flag className="text-red-400" size={18} />
              Pending Reports
              {reports.length > 0 && <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full border border-red-500/30">{reports.length} pending</span>}
            </h2>
            {reports.length === 0 ? (
              <div className="bg-rc-surface border border-rc-border rounded-2xl p-12 text-center">
                <CheckCircle className="text-green-400 mx-auto mb-3" size={40} />
                <p className="text-rc-muted">No pending reports. All clear!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {reports.map(report => (
                  <div key={report.id} className="bg-rc-surface border border-rc-border rounded-2xl p-5">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <UserX size={16} className="text-red-400 shrink-0" />
                          <span className="font-semibold text-white">{report.reportedName}</span>
                          {report.reportedEmail && (
                            <span className="text-xs text-rc-muted bg-rc-bg px-2 py-0.5 rounded-lg border border-rc-border">{report.reportedEmail}</span>
                          )}
                        </div>
                        <p className="text-sm"><span className="text-rc-muted">Reason:</span> <span className="text-amber-400 font-medium">{report.reason}</span></p>
                        {report.description && (
                          <p className="text-sm text-rc-muted italic">"{report.description}"</p>
                        )}
                        <p className="text-xs text-rc-dimmed">{formatDate(report.timestamp)}</p>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <button
                          onClick={() => handleBanFromReport(report, false)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg transition-colors"
                        >
                          <Ban size={12} /> Temp Ban (7d)
                        </button>
                        <button
                          onClick={() => handleBanFromReport(report, true)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition-colors"
                        >
                          <Ban size={12} /> Permanent Ban
                        </button>
                        <button
                          onClick={() => handleDismiss(report.id)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-rc-bg hover:bg-rc-surface text-rc-muted border border-rc-border rounded-lg transition-colors"
                        >
                          <XCircle size={12} /> Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ALL REPORTS TAB ── */}
        {activeTab === 'allreports' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Flag className="text-orange-400" size={18} />
                All Reports History
                <span className="text-xs font-normal text-rc-muted bg-rc-surface px-2 py-0.5 rounded-full border border-rc-border">{allReports.length} total</span>
              </h2>
              {role === 'owner' && allReports.length > 0 && (
                <button
                  onClick={handleClearAllReports}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Trash2 size={12} /> Clear All Reports
                </button>
              )}
            </div>
            {sortedReportGroups.length === 0 ? (
              <div className="bg-rc-surface border border-rc-border rounded-2xl p-12 text-center">
                <CheckCircle className="text-green-400 mx-auto mb-3" size={40} />
                <p className="text-rc-muted">No reports have been filed yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedReportGroups.map(([uid, group]) => {
                  const pendingCount   = group.reports.filter(r => r.status === 'pending').length;
                  const actionedCount  = group.reports.filter(r => r.status === 'actioned').length;
                  const dismissedCount = group.reports.filter(r => r.status === 'dismissed').length;
                  const reasonCounts   = group.reports.reduce<Record<string, number>>((acc, r) => {
                    const reason = r.reason || 'Unknown';
                    acc[reason] = (acc[reason] || 0) + 1;
                    return acc;
                  }, {});
                  const uniqueReporters = new Set(group.reports.map(r => r.reporterId)).size;
                  
                  return (
                    <div key={uid} className="bg-rc-surface border border-rc-border rounded-2xl p-5 space-y-3">
                      {/* Header: user info + count + quick ban */}
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/30 shrink-0">
                            <UserX size={16} className="text-red-400" />
                          </div>
                          <div>
                            <p className="font-semibold text-white">{group.name}</p>
                            {group.email && <p className="text-xs text-rc-muted">{group.email}</p>}
                            <p
                              className="text-xs text-rc-dimmed font-mono cursor-pointer hover:text-white transition-colors"
                              title="Click to copy UID"
                              onClick={() => { navigator.clipboard.writeText(uid); showMsg('UID copied!'); }}
                            >{uid} 📋</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
                          <span className={`text-base font-black px-3 py-1 rounded-xl border ${
                            uniqueReporters >= 5 ? 'text-red-400 bg-red-500/15 border-red-500/30'
                            : uniqueReporters >= 3 ? 'text-amber-400 bg-amber-500/15 border-amber-500/30'
                            : 'text-white bg-rc-bg border-rc-border'
                          }`}>
                            <span className="text-xs block text-rc-muted font-normal uppercase leading-tight">Unique Reporters</span>
                            {uniqueReporters} <span className="text-xs font-normal opacity-50">({group.reports.length} total)</span>
                          </span>
                          <button
                            onClick={async () => { if (!confirm(`Temp ban (7d) ${group.name}?`)) return; try { await manualBanUser(uid, group.email, group.name, 'Banned via All Reports', false); showMsg(`${group.name} temp-banned.`); } catch(e: any) { showMsg(e.message, true); } }}
                            className="text-[11px] px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg transition-colors"
                          >⏱ Temp Ban</button>
                          <button
                            onClick={async () => { if (!confirm(`Permanently ban ${group.name}?`)) return; try { await manualBanUser(uid, group.email, group.name, 'Permanently banned via All Reports', true); showMsg(`${group.name} permanently banned.`); } catch(e: any) { showMsg(e.message, true); } }}
                            className="text-[11px] px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition-colors"
                          >🚫 Perm Ban</button>
                          {role === 'owner' && (
                            <button
                              onClick={() => handleDeleteUserReports(uid, group.name)}
                              className="text-[11px] px-2.5 py-1 bg-rc-bg hover:bg-red-500/10 text-rc-muted hover:text-red-400 border border-rc-border hover:border-red-500/30 rounded-lg transition-colors flex items-center gap-1"
                              title={`Delete all ${group.reports.length} reports for ${group.name}`}
                            ><Trash2 size={10} /> Clear</button>
                          )}
                        </div>
                      </div>

                      {/* Status pills */}
                      <div className="flex flex-wrap gap-2">
                        {pendingCount > 0 && <span className="text-xs px-2 py-1 rounded-lg border text-amber-400 bg-amber-500/10 border-amber-500/30">{pendingCount} pending</span>}
                        {actionedCount > 0 && <span className="text-xs px-2 py-1 rounded-lg border text-red-400 bg-red-500/10 border-red-500/30">{actionedCount} actioned</span>}
                        {dismissedCount > 0 && <span className="text-xs px-2 py-1 rounded-lg border text-rc-muted bg-rc-surface border-rc-border">{dismissedCount} dismissed</span>}
                      </div>

                      {/* Reason tags */}
                      <div>
                        <p className="text-xs text-rc-muted font-semibold uppercase tracking-wider mb-2">Reported Reasons</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(reasonCounts).map(([reason, count]) => (
                            <span key={reason} className="text-xs px-2.5 py-1 rounded-lg bg-rc-bg border border-rc-border text-rc-text flex items-center gap-1.5">
                              <span className="w-4 h-4 rounded-full bg-rc-accent/30 text-[9px] font-bold text-rc-accentGlow flex items-center justify-center">{count}</span>
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Expandable timeline */}
                      <details>
                        <summary className="text-xs text-rc-muted cursor-pointer hover:text-rc-text transition-colors list-none flex items-center gap-1 select-none">
                          ▶ View all {group.reports.length} report(s)
                        </summary>
                        <div className="mt-3 space-y-2 border-l-2 border-rc-border pl-3">
                          {group.reports.map(r => (
                            <div key={r.id} className="flex items-start justify-between gap-3 text-xs bg-rc-bg/40 rounded-lg p-2">
                              <div className="flex-1 min-w-0">
                                <span className={`font-semibold ${STATUS_STYLE[r.status ?? 'pending']?.split(' ')[0] ?? ''}`}>{r.reason || 'Unknown'}</span>
                                {r.description && <p className="text-rc-muted italic mt-0.5">"{r.description}"</p>}
                                <p className="text-rc-dimmed mt-0.5">{formatDate(r.timestamp)}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold uppercase ${STATUS_STYLE[r.status ?? 'pending'] ?? ''}`}>
                                  {r.status || 'pending'}
                                </span>
                                {role === 'owner' && (
                                  <button
                                    onClick={() => handleDeleteReport(r.id)}
                                    title="Delete this report"
                                    className="p-1 rounded hover:bg-red-500/20 text-rc-dimmed hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── APPEALS TAB ── */}
        {activeTab === 'appeals' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <MessageSquare className="text-indigo-400" size={18} />
              Ban Appeals
              <span className="text-xs font-normal text-rc-muted bg-rc-surface px-2 py-0.5 rounded-full border border-rc-border">{appeals.length} total</span>
              {pendingAppeals > 0 && <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30">{pendingAppeals} pending</span>}
            </h2>

            {appeals.length === 0 ? (
              <div className="bg-rc-surface border border-rc-border rounded-2xl p-12 text-center">
                <CheckCircle className="text-green-400 mx-auto mb-3" size={40} />
                <p className="text-rc-muted">No ban appeals submitted yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {appeals.map(appeal => (
                  <div key={appeal.id} className={`bg-rc-surface border rounded-2xl p-5 space-y-3 ${appeal.status === 'pending' ? 'border-amber-500/30' : appeal.status === 'approved' ? 'border-green-500/20' : 'border-rc-border'}`}>
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center border shrink-0 ${appeal.status === 'pending' ? 'bg-amber-500/20 border-amber-500/30' : appeal.status === 'approved' ? 'bg-green-500/20 border-green-500/30' : 'bg-rc-bg border-rc-border'}`}>
                          <MessageSquare size={16} className={appeal.status === 'pending' ? 'text-amber-400' : appeal.status === 'approved' ? 'text-green-400' : 'text-rc-muted'} />
                        </div>
                        <div>
                          <p className="font-semibold text-white">{appeal.name}</p>
                          <p className="text-xs text-rc-muted">{appeal.email}</p>
                          <p className="text-xs text-rc-dimmed font-mono cursor-pointer hover:text-white transition-colors"
                            onClick={() => { navigator.clipboard.writeText(appeal.userId); showMsg('UID copied!'); }}
                            title="Click to copy UID">{appeal.userId} 📋</p>
                        </div>
                      </div>
                      <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-bold uppercase border ${appeal.status === 'pending' ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' : appeal.status === 'approved' ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-rc-muted bg-rc-surface border-rc-border'}`}>
                        {appeal.status}
                      </span>
                    </div>

                    {/* Ban reason */}
                    <div className="text-xs">
                      <p className="text-rc-muted font-semibold uppercase tracking-wider mb-1">Ban Reason</p>
                      <p className="text-rc-text">{appeal.banReason || 'Not specified'}</p>
                    </div>

                    {/* Appeal message */}
                    <div className="text-xs">
                      <p className="text-rc-muted font-semibold uppercase tracking-wider mb-1">Appeal Message</p>
                      <p className="text-rc-text bg-rc-bg border border-rc-border rounded-xl p-3 leading-relaxed">"{appeal.appealMessage}"</p>
                    </div>

                    {/* Submitted time + actioned by */}
                    <div className="flex flex-wrap gap-3 text-xs text-rc-dimmed">
                      <span>Submitted: {formatDate(appeal.timestamp)}</span>
                      {appeal.actionedBy && <span>Actioned by: {appeal.actionedBy}</span>}
                    </div>

                    {/* Actions — only for pending */}
                    {appeal.status === 'pending' && (() => {
                      const bannedUser = bannedUsers.find(u => u.userId === appeal.userId);
                      const isRestricted = role !== 'owner' && bannedUser?.bannedByRole === 'owner';
                      
                      return (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={async () => { if (!confirm(`Approve appeal & unban ${appeal.name}?`)) return; try { await approveAppeal(appeal.id, appeal.userId); showMsg(`${appeal.name} has been unbanned.`); } catch(e: any) { showMsg(e.message, true); } }}
                            disabled={isRestricted}
                            title={isRestricted ? "Only an Owner can approve appeals for users banned by an Owner" : ""}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isRestricted ? <Shield size={12} className="text-amber-400" /> : <CheckCircle size={12} />} 
                            Approve & Unban
                          </button>
                          <button
                            onClick={async () => { if (!confirm(`Deny appeal for ${appeal.name}?`)) return; try { await denyAppeal(appeal.id); showMsg(`Appeal denied.`); } catch(e: any) { showMsg(e.message, true); } }}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition-colors"
                          ><XCircle size={12} /> Deny</button>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── BANNED USERS TAB ── */}
        {activeTab === 'banned' && (
          <div className="space-y-6">
            {/* Manual Ban Form */}
            <div className="bg-rc-surface border border-rc-border rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                <Ban className="text-red-400" size={18} />
                Manual Ban
              </h2>
              <form onSubmit={handleManualBan} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input value={banUserId} onChange={e => setBanUserId(e.target.value)} placeholder="User UID *" required
                  className="bg-rc-bg border border-rc-border rounded-xl p-3 text-white focus:border-rc-accent outline-none text-sm font-mono" />
                <input value={banEmail} onChange={e => setBanEmail(e.target.value)} placeholder="User Email (optional)"
                  className="bg-rc-bg border border-rc-border rounded-xl p-3 text-white focus:border-rc-accent outline-none text-sm" />
                <input value={banName} onChange={e => setBanName(e.target.value)} placeholder="Display Name (optional)"
                  className="bg-rc-bg border border-rc-border rounded-xl p-3 text-white focus:border-rc-accent outline-none text-sm" />
                <input value={banReason} onChange={e => setBanReason(e.target.value)} placeholder="Reason *" required
                  className="bg-rc-bg border border-rc-border rounded-xl p-3 text-white focus:border-rc-accent outline-none text-sm" />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={banPermanent} onChange={e => setBanPermanent(e.target.checked)}
                      className="w-4 h-4 accent-red-500" />
                    <span className="text-sm text-rc-muted">Permanent ban</span>
                  </label>
                  {!banPermanent && <span className="text-xs text-amber-400">7-day temp ban</span>}
                </div>
                <button type="submit" disabled={isLoading}
                  className="bg-red-500 hover:bg-red-600 text-white font-medium py-2 rounded-xl transition-colors text-sm disabled:opacity-50">
                  Ban User
                </button>
              </form>
            </div>

            {/* Banned List */}
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-3">
                <UserX className="text-red-400" size={18} />
                Currently Banned ({bannedUsers.length})
              </h2>
              {bannedUsers.length === 0 ? (
                <div className="bg-rc-surface border border-rc-border rounded-2xl p-10 text-center">
                  <p className="text-rc-muted">No users are currently banned.</p>
                </div>
              ) : (
                <div className="bg-rc-surface border border-rc-border rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-rc-bg border-b border-rc-border">
                      <tr>
                        <th className="p-3 text-left text-rc-muted font-medium">User</th>
                        <th className="p-3 text-left text-rc-muted font-medium hidden sm:table-cell">Reason</th>
                        <th className="p-3 text-center text-rc-muted font-medium">Type</th>
                        <th className="p-3 text-left text-rc-muted font-medium hidden md:table-cell">Banned By</th>
                        <th className="p-3 text-right text-rc-muted font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bannedUsers.map(u => (
                        <tr key={u.userId} className="border-b border-rc-border/50 last:border-0 hover:bg-rc-bg/30">
                          <td className="p-3">
                            <p className="font-medium text-white">{u.name || u.email || 'Unknown'}</p>
                            {u.email && u.name && <p className="text-xs text-rc-muted">{u.email}</p>}
                            {u.expiresAt && !u.permanent && (
                              <p className="text-xs text-amber-400">Expires: {formatDate(u.expiresAt)}</p>
                            )}
                          </td>
                          <td className="p-3 text-rc-muted text-xs hidden sm:table-cell max-w-[180px] truncate">{u.reason}</td>
                          <td className="p-3 text-center">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${u.permanent ? 'text-red-400 bg-red-500/10 border-red-500/30' : 'text-amber-400 bg-amber-500/10 border-amber-500/30'}`}>
                              {u.permanent ? 'PERM' : '7-DAY'}
                            </span>
                          </td>
                          <td className="p-3 text-xs text-rc-muted hidden md:table-cell">
                            <div className="flex flex-col">
                              <span>{u.bannedBy}</span>
                              {u.bannedByRole && (
                                <span className={`text-[9px] font-bold uppercase ${u.bannedByRole === 'owner' ? 'text-amber-400' : 'text-blue-400'}`}>
                                  {u.bannedByRole}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            {(() => {
                              const isRestricted = role !== 'owner' && u.bannedByRole === 'owner';
                              return (
                                <button 
                                  onClick={() => handleUnban(u.userId, u.name || u.email || '')}
                                  disabled={isRestricted}
                                  title={isRestricted ? "Only an Owner can unban users banned by an Owner" : ""}
                                  className="text-green-400 hover:text-green-300 text-xs px-3 py-1 rounded-lg border border-green-500/30 hover:bg-green-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                                >
                                  {isRestricted ? <Shield size={12} className="text-amber-400" /> : '🔓'} 
                                  Unban
                                </button>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ANNOUNCEMENTS TAB ── */}
        {activeTab === 'announcements' && (
          <div className="bg-rc-surface border border-rc-border rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
              <Volume2 className="text-rc-accent" size={18} />
              Global Announcement
            </h2>
            <form onSubmit={handlePublish} className="space-y-4">
              <textarea value={announcement} onChange={e => setAnnouncement(e.target.value)}
                placeholder="Type a message to display to all active users..."
                className="w-full bg-rc-bg border border-rc-border rounded-xl p-3 text-white focus:border-rc-accent outline-none min-h-[100px] resize-none" />
              <div className="flex gap-3">
                <button type="submit" disabled={isLoading} className="flex-1 bg-rc-accent hover:bg-rc-accent/80 text-white font-medium py-2 rounded-xl transition-colors">
                  Publish
                </button>
                <button type="button" onClick={handleClear} disabled={isLoading}
                  className="px-5 bg-rc-bg border border-rc-border hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/50 text-rc-muted rounded-xl transition-colors text-sm">
                  Clear
                </button>
              </div>
            </form>
            <div className="mt-4 bg-rc-bg border border-rc-border/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={14} className="text-indigo-400" />
                <span className="text-xs font-semibold text-rc-muted uppercase tracking-wider">Platform Status</span>
              </div>
              <span className="text-green-400 text-sm font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> System Online
              </span>
            </div>
          </div>
        )}

        {/* ── ADMINS TAB (Owner Only) ── */}
        {activeTab === 'admins' && role === 'owner' && (
          <div className="bg-rc-surface border border-rc-border rounded-2xl p-6 space-y-5">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Users className="text-amber-400" size={18} />
              Admin Management <span className="text-xs font-normal text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">Owner Exclusive</span>
            </h2>
            <form onSubmit={handleGrantAdmin} className="flex gap-3">
              <input type="email" value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)}
                placeholder="Enter email to grant admin rights"
                className="flex-1 bg-rc-bg border border-rc-border rounded-xl p-3 text-white focus:border-rc-accent outline-none text-sm" />
              <button type="submit" disabled={isLoading} className="bg-amber-500 hover:bg-amber-600 text-white font-medium px-5 rounded-xl transition-colors text-sm">
                Grant
              </button>
            </form>
            <div className="bg-rc-bg border border-rc-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-rc-surface border-b border-rc-border">
                  <tr>
                    <th className="p-3 text-left text-rc-muted font-medium">Admin Email</th>
                    <th className="p-3 text-right text-rc-muted font-medium">Revoke</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.length === 0 ? (
                    <tr><td colSpan={2} className="p-4 text-center text-rc-muted">No additional admins assigned.</td></tr>
                  ) : admins.map(email => (
                    <tr key={email} className="border-b border-rc-border/50 last:border-0">
                      <td className="p-3 text-white">{email}</td>
                      <td className="p-3 text-right">
                        <button onClick={() => handleRevokeAdmin(email)}
                          className="text-red-400 hover:text-red-300 p-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── PRO USERS TAB (Owner Only) ── */}
        {activeTab === 'subscriptions' && role === 'owner' && (
          <div className="space-y-6">
            <div className="bg-rc-surface border border-rc-border rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                <Star className="text-amber-400" size={18} />
                Manage Subscriptions
              </h2>
              <div className="flex items-center gap-4 mb-4">
                <button 
                  onClick={() => setProSearchType('uid')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${proSearchType === 'uid' ? 'bg-rc-accent border-rc-accent text-white' : 'border-rc-border text-rc-muted'}`}
                >
                  By UID
                </button>
                <button 
                  onClick={() => setProSearchType('email')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${proSearchType === 'email' ? 'bg-rc-accent border-rc-accent text-white' : 'border-rc-border text-rc-muted'}`}
                >
                  By Email
                </button>
              </div>

              <form onSubmit={handleManualProGrant} className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-rc-muted" size={16} />
                  <input 
                    type={proSearchType === 'uid' ? 'text' : 'email'}
                    value={proSearchType === 'uid' ? proSearchUid : proSearchEmail} 
                    onChange={e => proSearchType === 'uid' ? setProSearchUid(e.target.value) : setProSearchEmail(e.target.value)}
                    placeholder={proSearchType === 'uid' ? "Enter User UID..." : "Enter User Email..."}
                    className="w-full bg-rc-bg border border-rc-border rounded-xl pl-10 pr-4 py-3 text-white focus:border-rc-accent outline-none text-sm font-mono" 
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={isLoading || (proSearchType === 'uid' ? !proSearchUid.trim() : !proSearchEmail.trim())} 
                  className="bg-amber-500 hover:bg-amber-600 text-white font-medium px-6 rounded-xl transition-colors text-sm disabled:opacity-50"
                >
                  Grant Pro
                </button>
              </form>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-3">
                <Zap className="text-rc-accent" size={18} />
                Active Pro Members ({proUsers.length})
              </h2>
              {proUsers.length === 0 ? (
                <div className="bg-rc-surface border border-rc-border rounded-2xl p-10 text-center">
                  <p className="text-rc-muted">No active Pro members found.</p>
                </div>
              ) : (
                <div className="bg-rc-surface border border-rc-border rounded-2xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-rc-bg border-b border-rc-border">
                      <tr>
                        <th className="p-4 text-left text-rc-muted font-medium">User</th>
                        <th className="p-4 text-left text-rc-muted font-medium hidden sm:table-cell">UID</th>
                        <th className="p-4 text-center text-rc-muted font-medium">Status</th>
                        <th className="p-4 text-right text-rc-muted font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proUsers.map(u => (
                        <tr key={u.uid} className="border-b border-rc-border/50 last:border-0 hover:bg-rc-bg/30">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                                <Star size={14} className="text-amber-400 fill-amber-400" />
                              </div>
                              <div>
                                <p className="font-medium text-white">{u.name || u.email?.split('@')[0] || 'Unknown'}</p>
                                {u.email && <p className="text-xs text-rc-muted">{u.email}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-rc-dimmed font-mono text-xs hidden sm:table-cell">
                            <span 
                              className="cursor-pointer hover:text-white transition-colors"
                              onClick={() => { navigator.clipboard.writeText(u.uid); showMsg('UID copied!'); }}
                            >
                              {u.uid}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border text-amber-400 bg-amber-500/10 border-amber-500/30 uppercase tracking-wider">
                              {u.status || 'Active'}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <button 
                              onClick={() => handleTogglePro(u.uid, true, u.email)}
                              className="text-red-400 hover:text-red-300 text-xs px-3 py-1.5 rounded-lg border border-red-500/30 hover:bg-red-500/10 transition-colors"
                            >
                              Revoke Pro
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── COUPONS TAB (Owner Only) ── */}
        {activeTab === 'coupons' && role === 'owner' && (
          <div className="space-y-6">
            <div className="bg-rc-surface border border-rc-border rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                <Plus className="text-rc-accent" size={18} />
                Create New Coupon
              </h2>
              <form onSubmit={handleCreateCoupon} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-rc-muted uppercase tracking-wider">Coupon Code</label>
                  <div className="relative">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 text-rc-muted" size={14} />
                    <input 
                      type="text" 
                      value={cpCode} 
                      onChange={e => setCpCode(e.target.value.toUpperCase())}
                      placeholder="e.g. SAVE50"
                      className="w-full bg-rc-bg border border-rc-border rounded-xl pl-9 pr-4 py-2.5 text-white focus:border-rc-accent outline-none text-sm font-bold tracking-widest" 
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-rc-muted uppercase tracking-wider">Discount (%)</label>
                  <input 
                    type="number" 
                    value={cpDiscount} 
                    onChange={e => setCpDiscount(e.target.value)}
                    min="1" max="100"
                    className="w-full bg-rc-bg border border-rc-border rounded-xl px-4 py-2.5 text-white focus:border-rc-accent outline-none text-sm font-bold" 
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-rc-muted uppercase tracking-wider">Expiry Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-rc-muted" size={14} />
                    <input 
                      type="date" 
                      value={cpExpiry} 
                      onChange={e => setCpExpiry(e.target.value)}
                      className="w-full bg-rc-bg border border-rc-border rounded-xl pl-9 pr-4 py-2.5 text-white focus:border-rc-accent outline-none text-sm font-bold" 
                    />
                  </div>
                </div>
                <div className="flex items-end pb-1 gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={cpActive} onChange={e => setCpActive(e.target.checked)} className="w-4 h-4 accent-rc-accent" />
                    <span className="text-xs text-rc-muted">Active</span>
                  </label>
                  <button 
                    type="submit" 
                    disabled={isLoading || !cpCode.trim()} 
                    className="flex-1 bg-rc-accent hover:bg-rc-accent/80 text-white font-bold py-2.5 rounded-xl transition-all shadow-glowSm text-sm"
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-3">
                <Ticket className="text-amber-400" size={18} />
                Active Coupons ({coupons.length})
              </h2>
              {coupons.length === 0 ? (
                <div className="bg-rc-surface border border-rc-border rounded-2xl p-10 text-center">
                  <p className="text-rc-muted">No coupons created yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {coupons.map(cp => (
                    <div key={cp.id} className="bg-rc-surface border border-rc-border rounded-2xl p-5 relative overflow-hidden group">
                      {!cp.active && <div className="absolute inset-0 bg-rc-bg/60 backdrop-blur-[1px] z-10 flex items-center justify-center font-bold text-rc-muted uppercase tracking-tighter text-2xl -rotate-12 pointer-events-none">Inactive</div>}
                      <div className="flex justify-between items-start mb-4">
                        <div className="bg-rc-accent/10 px-3 py-1 rounded-lg border border-rc-accent/30">
                          <span className="text-rc-accentGlow font-black tracking-widest text-lg">{cp.code}</span>
                        </div>
                        <button 
                          onClick={() => handleDeleteCoupon(cp.id, cp.code)}
                          className="p-1.5 text-rc-muted hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-rc-muted">Discount</span>
                          <span className="text-green-400 font-bold">{cp.discountPercent}% OFF</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-rc-muted">Usage</span>
                          <span className="text-rc-text font-medium">{cp.usageCount} times</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-rc-muted">Expires</span>
                          <span className={cp.expiresAt && cp.expiresAt.toDate() < new Date() ? 'text-red-400 font-bold' : 'text-rc-text'}>
                            {cp.expiresAt ? formatDate(cp.expiresAt) : 'Never'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
