import { useRef, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import OutlinedInput from '@mui/material/OutlinedInput';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// project imports
import FormField from 'components/FormField';
import useAuth from 'hooks/useAuth';
import { AUTH_MODE, EMAIL_PATTERN } from 'api/auth';

// assets
import EyeInvisibleOutlined from '@ant-design/icons/EyeInvisibleOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import TeamOutlined from '@ant-design/icons/TeamOutlined';

// ==============================|| AUTH - LOGIN FORM ||============================== //

// Keyed by Firebase Auth's codes (see api/auth.js), so these survive the provider swap.
const MESSAGES = {
  'auth/invalid-credential': 'That email and password don’t match an account. Check both and try again.',
  'auth/user-disabled': 'This account has been turned off. Ask your project admin to restore it.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute, then try again.',
  'auth/network-request-failed': 'Couldn’t reach the sign-in service. Check your connection and try again.'
};

function validate({ email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = 'Enter your email address.';
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter an email address like name@institute.org.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

/**
 * Posts to api/auth and does nothing else on success: the route guard around the login
 * page (routes/guards → GuestOnly) sees the new session and moves on to `?next=` or the
 * landing page, so there is exactly one place that decides where a signed-in user goes.
 */
export default function LoginForm() {
  const { signIn, reason } = useAuth();

  const [values, setValues] = useState({ email: '', password: '', remember: false });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  const update = (field) => (event) => {
    const value = field === 'remember' ? event.target.checked : event.target.value;
    setValues((prev) => ({ ...prev, [field]: value }));
    // a field stops shouting as soon as it is being fixed
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const trackCapsLock = (event) => setCapsLock(Boolean(event.getModifierState?.('CapsLock')));

  const onSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const found = validate(values);
    setErrors(found);
    setFormError(null);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();

    setSubmitting(true);
    try {
      await signIn({ email: values.email.trim(), password: values.password, remember: values.remember });
      // success: GuestOnly takes it from here, and this form unmounts
    } catch (error) {
      setFormError(MESSAGES[error?.code] || 'Something went wrong signing in. Try again.');
      setSubmitting(false);
      passwordRef.current?.focus();
    }
  };

  const passwordHelper = errors.password || (capsLock ? 'Caps Lock is on.' : null);

  return (
    <Stack component="form" noValidate onSubmit={onSubmit} aria-labelledby="login-title" sx={{ width: '100%', maxWidth: 400, gap: 3 }}>
      <Stack sx={{ gap: 1 }}>
        <Typography id="login-title" component="h1" variant="h2">
          Sign in
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', fontSize: '0.9375rem' }}>
          Welcome back — your trials are where you left them.
        </Typography>
      </Stack>

      {reason === 'expired' && !formError && <Alert severity="info">Your session ended. Sign in again to pick up where you were.</Alert>}
      {formError && <Alert severity="error">{formError}</Alert>}

      <FormField id="login-email" label="Email" error={Boolean(errors.email)} helperText={errors.email}>
        <OutlinedInput
          id="login-email"
          inputRef={emailRef}
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          fullWidth
          placeholder="name@institute.org"
          value={values.email}
          onChange={update('email')}
          error={Boolean(errors.email)}
          inputProps={{ 'aria-describedby': errors.email ? 'login-email-helper' : undefined, spellCheck: false }}
        />
      </FormField>

      <FormField id="login-password" label="Password" error={Boolean(errors.password)} helperText={passwordHelper}>
        <OutlinedInput
          id="login-password"
          inputRef={passwordRef}
          name="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          required
          fullWidth
          placeholder="Your password"
          value={values.password}
          onChange={update('password')}
          onKeyDown={trackCapsLock}
          onKeyUp={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          error={Boolean(errors.password)}
          inputProps={{ 'aria-describedby': passwordHelper ? 'login-password-helper' : undefined }}
          endAdornment={
            <InputAdornment position="end">
              <IconButton
                edge="end"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((shown) => !shown)}
                // keep the caret in the field when the eye is clicked
                onMouseDown={(event) => event.preventDefault()}
                sx={{ color: 'text.secondary' }}
              >
                {showPassword ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              </IconButton>
            </InputAdornment>
          }
        />
      </FormField>

      <Box sx={{ mt: -1.5 }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <FormControlLabel
            control={<Checkbox name="remember" size="small" checked={values.remember} onChange={update('remember')} />}
            label={<Typography variant="body1">Keep me signed in</Typography>}
          />
          <Button
            variant="text"
            size="small"
            aria-expanded={resetOpen}
            aria-controls="login-reset-help"
            onClick={() => setResetOpen((open) => !open)}
            sx={{ px: 0.75, minWidth: 0, color: 'text.secondary', '&:hover': { color: 'primary.main', bgcolor: 'transparent' } }}
          >
            Forgot password?
          </Button>
        </Stack>
        <Collapse in={resetOpen}>
          <Typography id="login-reset-help" variant="body1" sx={{ color: 'text.secondary', pt: 1 }}>
            Password resets go through your project admin — ask them to send you a new sign-in link.
          </Typography>
        </Collapse>
      </Box>

      <Button type="submit" variant="contained" size="large" fullWidth loading={submitting} loadingPosition="start">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>

      <Divider />

      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'flex-start', color: 'text.secondary' }}>
        <TeamOutlined style={{ fontSize: '1rem', marginTop: 2 }} />
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          Croplytix is invite-only. To get access, ask a project admin to add your email.
        </Typography>
      </Stack>

      {AUTH_MODE === 'preview' && (
        <Typography variant="caption" sx={{ color: 'text.disabled', mt: -1.5 }}>
          Preview sign-in: any email and password will work until accounts are connected.
        </Typography>
      )}
    </Stack>
  );
}
