import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// material-ui
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

// project imports
import useAuth from 'hooks/useAuth';

// assets
import LogoutOutlined from '@ant-design/icons/LogoutOutlined';

// ==============================|| HEADER CONTENT - ACCOUNT ||============================== //

// Initials on the nav's selected-pill colours: neon on deep leaf, the app's "this is you" pairing.
const avatarSx = { bgcolor: 'primary.lighter', color: 'primary.main', fontWeight: 600, fontSize: '0.8125rem' };

/**
 * Who is signed in, and the way out. A Popover holding a MenuList (rather than a Menu)
 * so the name and email can sit above the actions without being announced as menu
 * items; the MenuList still gives arrow-key movement and focus on open.
 */
export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  if (!user) return null;

  const handleSignOut = () => {
    setAnchorEl(null);
    signOut();
    // an explicit sign-out goes to a plain /login, not back to this page afterwards
    navigate('/login', { replace: true });
  };

  return (
    <Box sx={{ flexShrink: 0, ml: 'auto' }}>
      <Tooltip title="Account" disableInteractive>
        <ButtonBase
          aria-label={`Account: ${user.displayName}`}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          aria-controls={open ? 'account-menu' : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={(theme) => ({
            borderRadius: '50%',
            '&:focus-visible': { outline: `2px solid ${theme.vars.palette.primary.main}`, outlineOffset: 2 }
          })}
        >
          <Avatar sx={{ ...avatarSx, width: 34, height: 34, '&:hover': { outline: '1px solid', outlineColor: 'primary.main' } }}>
            {user.initials}
          </Avatar>
        </ButtonBase>
      </Tooltip>

      <Popover
        id="account-menu"
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: (theme) => ({
              mt: 1,
              width: 272,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: theme.vars.customShadows.z1
            })
          }
        }}
      >
        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', px: 2, py: 1.75 }}>
          <Avatar sx={{ ...avatarSx, width: 40, height: 40 }}>{user.initials}</Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {user.displayName}
            </Typography>
            <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
              {user.email}
            </Typography>
          </Box>
        </Stack>
        <Divider />
        <MenuList autoFocusItem={open} aria-label="Account actions" sx={{ py: 0.75 }}>
          <MenuItem onClick={handleSignOut}>
            <ListItemIcon sx={{ color: 'text.secondary' }}>
              <LogoutOutlined />
            </ListItemIcon>
            <ListItemText>Sign out</ListItemText>
          </MenuItem>
        </MenuList>
      </Popover>
    </Box>
  );
}
