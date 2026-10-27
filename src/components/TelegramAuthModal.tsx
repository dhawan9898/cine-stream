// TelegramAuthModal.tsx - Multi-step login and channel selection modal for Telegram
import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2, AlertCircle, X, Shield, Tv } from 'lucide-react';
import { telegramService, type TelegramChannelInfo } from '../services/telegramService.ts';

interface TelegramAuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const TelegramAuthModal: React.FC<TelegramAuthModalProps> = ({ open, onClose, onSuccess }) => {
  const [step, setStep] = useState<'phone' | 'code' | 'channels'>('phone');
  const [phone, setPhone] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [channels, setChannels] = useState<TelegramChannelInfo[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setStep('phone');
      setPhone('');
      setCode('');
      setPassword('');
      setError(null);
      setRequiresPassword(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSendCode = async () => {
    if (!phone || phone.length < 5) {
      setError('Please enter a valid phone number with country code (e.g. +1234567890)');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await telegramService.sendAuthCode(phone.trim());
      setPhoneCodeHash(res.phoneCodeHash);
      setStep('code');
    } catch (err: any) {
      setError(err?.message || 'Failed to send verification code. Check phone format.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    if (!code || code.length < 3) {
      setError('Please enter the verification code sent to your Telegram account');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await telegramService.signIn(phone.trim(), phoneCodeHash, code.trim(), password ? password.trim() : undefined);
      if (res.success) {
        // Load channels for selection
        const chList = await telegramService.getUserChannels();
        setChannels(chList);
        const existingSelected = await telegramService.getSelectedChannels();
        setSelectedChannelIds(existingSelected.length > 0 ? existingSelected : chList.map(c => c.id));
        setStep('channels');
      } else {
        if (res.error?.includes('SESSION_PASSWORD_NEEDED')) {
          setRequiresPassword(true);
          setError('Two-Step Verification password required.');
        } else {
          setError(res.error || 'Authentication failed. Please verify your code.');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Login error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const toggleChannel = (id: string) => {
    setSelectedChannelIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      await telegramService.saveSelectedChannels(selectedChannelIds);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save channel selection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '440px',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        boxShadow: 'var(--shadow-glow)',
        position: 'relative'
      }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer'
          }}
        >
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Send size={20} color="#fff" />
          </div>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
              {step === 'channels' ? 'Select Media Channels' : 'Connect Telegram'}
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {step === 'phone' && 'Enter your phone number to sign in'}
              {step === 'code' && 'Enter the code sent to your Telegram app'}
              {step === 'channels' && 'Choose channels to scan for movies and TV shows'}
            </p>
          </div>
        </div>

        {error && (
          <div style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '16px'
          }}>
            <AlertCircle size={18} color="var(--accent-danger)" />
            <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{error}</span>
          </div>
        )}

        {step === 'phone' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                Phone Number (with Country Code)
              </label>
              <input
                type="tel"
                placeholder="+1 234 567 8900"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>
            <button
              onClick={handleSendCode}
              disabled={loading}
              className="interactive"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--accent-gradient)',
                color: '#fff',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? 'Sending Code...' : 'Send Verification Code'}
            </button>
          </div>
        )}

        {step === 'code' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                Telegram Verification Code
              </label>
              <input
                type="text"
                placeholder="12345"
                value={code}
                onChange={e => setCode(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>

            {requiresPassword && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                  2FA Password
                </label>
                <input
                  type="password"
                  placeholder="Your 2FA Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    outline: 'none'
                  }}
                />
              </div>
            )}

            <button
              onClick={handleSignIn}
              disabled={loading}
              className="interactive"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--accent-gradient)',
                color: '#fff',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? 'Verifying...' : 'Sign In'}
            </button>
          </div>
        )}

        {step === 'channels' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {channels.length === 0 ? (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>
                  No channels found in your Telegram account.
                </p>
              ) : (
                channels.map(ch => (
                  <div
                    key={ch.id}
                    onClick={() => toggleChannel(ch.id)}
                    className="interactive"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: selectedChannelIds.includes(ch.id) ? 'rgba(229, 9, 20, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid ' + (selectedChannelIds.includes(ch.id) ? 'var(--accent-primary)' : 'var(--border-subtle)')
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Tv size={16} color="var(--accent-primary)" />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{ch.title}</div>
                        {ch.username && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>@{ch.username}</div>}
                      </div>
                    </div>
                    {selectedChannelIds.includes(ch.id) && <CheckCircle2 size={16} color="var(--accent-primary)" />}
                  </div>
                ))
              )}
            </div>

            <button
              onClick={handleFinish}
              disabled={loading}
              className="interactive"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--accent-gradient)',
                color: '#fff',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? 'Saving...' : 'Done'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
