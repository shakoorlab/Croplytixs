import PropTypes from 'prop-types';
import { useCallback, useId, useRef, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';

// assets
import InboxOutlined from '@ant-design/icons/InboxOutlined';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import CloseOutlined from '@ant-design/icons/CloseOutlined';

// ==============================|| FLIGHT SETUP - FILE DROP CARD ||============================== //

/**
 * Dashed drop target with a filled "staged" state. Deliberately dependency-free —
 * the project has no dropzone library and this needs ~40 lines of drag handling.
 */
export default function FileDropCard({
  label,
  hint,
  accept,
  multiple = false,
  directory = false,
  staged = null,
  error = null,
  icon,
  onSelect,
  onClear,
  busy = false,
  disabled = false
}) {
  const inputRef = useRef(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (fileList) => {
      if (!fileList || !fileList.length) return;
      onSelect?.(fileList);
    },
    [onSelect]
  );

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFiles(event.dataTransfer?.files);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    if (!disabled) setDragging(true);
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const isStaged = Boolean(staged);
  const locked = disabled || busy;

  return (
    <Box>
      <Box
        component="label"
        htmlFor={inputId}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        sx={(theme) => ({
          display: 'block',
          px: 2,
          py: 1.75,
          minHeight: 92,
          borderRadius: 1,
          cursor: locked ? 'progress' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          border: '1px dashed',
          borderColor: error ? 'error.main' : dragging ? 'primary.main' : isStaged ? 'grey.A800' : 'grey.200',
          // raised surface so the drop target reads as an object on the card
          // behind it, not as an empty region of it
          bgcolor: dragging ? 'primary.lighter' : 'grey.100',
          transition: theme.transitions.create(['border-color', 'background-color'], { duration: 150 }),
          '&:hover': { borderColor: disabled ? undefined : 'primary.main' }
        })}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          hidden
          accept={accept}
          multiple={multiple}
          disabled={locked}
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
          {...(directory ? { webkitdirectory: '', directory: '' } : {})}
        />

        {busy ? (
          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center' }}>
            <CircularProgress size={20} />
            <Stack sx={{ gap: 0.25 }}>
              <Typography variant="subtitle1">Reading…</Typography>
              <Typography variant="caption" color="text.secondary">
                Decoding the file in your browser — large orthos take a moment
              </Typography>
            </Stack>
          </Stack>
        ) : !isStaged ? (
          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center' }}>
            <Box sx={{ color: 'text.secondary', fontSize: '1.5rem', display: 'flex' }}>{icon || <InboxOutlined />}</Box>
            <Stack sx={{ gap: 0.25, minWidth: 0 }}>
              <Typography variant="subtitle1">{label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {hint}
              </Typography>
            </Stack>
          </Stack>
        ) : (
          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'flex-start' }}>
            <Box sx={{ color: 'success.main', fontSize: '1.15rem', display: 'flex', mt: 0.25 }}>
              <CheckCircleFilled />
            </Box>
            <Stack sx={{ gap: 0.5, minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} noWrap>
                {staged.name}
              </Typography>
              <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
                {staged.meta?.map((item) => (
                  <Typography key={item} variant="caption" color="text.secondary">
                    {item}
                  </Typography>
                ))}
              </Stack>
            </Stack>
            {onClear && (
              <Button
                size="small"
                color="secondary"
                startIcon={<CloseOutlined />}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onClear();
                }}
                sx={{ flexShrink: 0 }}
              >
                Replace
              </Button>
            )}
          </Stack>
        )}
      </Box>

      <Collapse in={Boolean(error)}>
        <Alert severity="error" variant="outlined" sx={{ mt: 1, py: 0.25 }} onClick={openPicker}>
          {error}
        </Alert>
      </Collapse>
    </Box>
  );
}

FileDropCard.propTypes = {
  label: PropTypes.string,
  hint: PropTypes.string,
  accept: PropTypes.string,
  multiple: PropTypes.bool,
  directory: PropTypes.bool,
  staged: PropTypes.shape({ name: PropTypes.string, meta: PropTypes.arrayOf(PropTypes.string) }),
  error: PropTypes.string,
  icon: PropTypes.node,
  onSelect: PropTypes.func,
  onClear: PropTypes.func,
  busy: PropTypes.bool,
  disabled: PropTypes.bool
};
