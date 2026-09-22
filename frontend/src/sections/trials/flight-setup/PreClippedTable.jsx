import PropTypes from 'prop-types';
import { useMemo } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

// project imports
import MainCard from 'components/MainCard';
import { NESTED_PANEL } from 'sections/trials/surfaces';
import { patternToRegex } from './utils';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

// ==============================|| FLIGHT SETUP - PRE-CLIPPED TABLE ||============================== //

/**
 * The alternative source mode: a folder of already-clipped plot images.
 * The filename pattern is the whole point — nobody should ever type 144 plot IDs.
 */
export default function PreClippedTable({ pattern, onPatternChange, rows = [], totalCount = 0, parsedCount = 0, disabled = false }) {
  const { regex, tokens } = useMemo(() => patternToRegex(pattern), [pattern]);
  const allParsed = totalCount > 0 && parsedCount === totalCount;

  return (
    <MainCard content={false} sx={NESTED_PANEL}>
      <Stack direction="row" sx={{ gap: 1.5, px: 2, py: 1.75, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ minWidth: 116 }}>
          Filename pattern
        </Typography>
        <TextField
          size="small"
          value={pattern}
          onChange={(event) => onPatternChange(event.target.value)}
          disabled={disabled}
          error={!regex}
          helperText={!regex ? 'Pattern is not a valid expression' : undefined}
          slotProps={{ input: { sx: mono } }}
          sx={{ flex: '1 1 260px' }}
        />
        <Chip
          size="small"
          label={`${parsedCount} / ${totalCount} parsed`}
          sx={{
            color: allParsed ? 'success.main' : 'warning.main',
            bgcolor: allParsed ? 'success.lighter' : 'warning.lighter'
          }}
        />
      </Stack>

      {tokens.length > 0 && (
        <Box sx={{ px: 2, pb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Capturing {tokens.map((t) => `{${t}}`).join(' · ')} — anything that fails to parse drops to the bottom for a manual fix and does
            not block the rest of the run.
          </Typography>
        </Box>
      )}

      <Divider />

      <TableContainer sx={{ maxHeight: 268 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>File</TableCell>
              <TableCell>Plot</TableCell>
              <TableCell>Genotype</TableCell>
              <TableCell>Date</TableCell>
              <TableCell align="right">Bands</TableCell>
              <TableCell align="right">GSD</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.file} hover>
                <TableCell sx={mono}>{row.file}</TableCell>
                <TableCell sx={mono}>{row.plot}</TableCell>
                <TableCell sx={mono}>{row.genotype}</TableCell>
                <TableCell sx={mono}>{row.date}</TableCell>
                <TableCell sx={{ ...mono }} align="right">
                  {row.bands}
                </TableCell>
                <TableCell sx={{ ...mono }} align="right">
                  {row.gsdCm} cm/px
                </TableCell>
              </TableRow>
            ))}
            {totalCount > rows.length && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="caption" color="text.secondary">
                    … {totalCount - rows.length} more
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={6} sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary" align="center">
                    Drop a folder of clipped plot images to preview the parse.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </MainCard>
  );
}

PreClippedTable.propTypes = {
  pattern: PropTypes.string.isRequired,
  onPatternChange: PropTypes.func.isRequired,
  rows: PropTypes.array,
  totalCount: PropTypes.number,
  parsedCount: PropTypes.number,
  disabled: PropTypes.bool
};
