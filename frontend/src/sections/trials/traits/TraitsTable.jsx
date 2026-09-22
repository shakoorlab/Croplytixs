import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

const frame = (theme) => ({
  border: '1px solid',
  borderColor: 'grey.A800',
  borderRadius: 1,
  overflow: 'hidden',
  boxShadow: theme.vars.customShadows.card,
  '& tbody tr:last-of-type td': { borderBottom: 0 }
});

const COLUMNS = [
  { key: 'rank', label: '#', align: 'right', get: (row) => row.rank },
  { key: 'genotype', label: 'Genotype', align: 'left', get: (row) => Number(row.genotype) },
  { key: 'reps', label: 'Plots', align: 'right', get: (row) => row.reps },
  {
    key: 'daysTo50',
    label: 'Days to 50 %',
    align: 'right',
    get: (row) => row.traits.daysTo50,
    help: 'First date the curve crosses 50 % cover, interpolated. Blank if it never gets there.'
  },
  {
    key: 'auc',
    label: 'Cover AUC',
    align: 'right',
    get: (row) => row.traits.auc,
    help: 'Area under the cover curve in cover-days — a season total of how much ground was green, for how long.'
  },
  {
    key: 'maxRate',
    label: 'Max rate',
    align: 'right',
    get: (row) => row.traits.maxRate,
    help: 'Steepest rise between two consecutive dates, in cover points per day.'
  },
  { key: 'coverAt', label: 'Cover @ DAP', align: 'right', get: (row) => row.traits.coverAt },
  { key: 'finalCover', label: 'Final cover', align: 'right', get: (row) => row.traits.finalCover }
];

const fmt = (value, digits = 1) => (value == null ? '—' : Number(value).toFixed(digits));

// ==============================|| TRAITS - TABLE ||============================== //

export default function TraitsTable({ genotypes, targetDap, selected = [], onToggle, filter = '' }) {
  const [orderBy, setOrderBy] = useState('rank');
  const [direction, setDirection] = useState('asc');

  const rows = useMemo(() => {
    const column = COLUMNS.find((candidate) => candidate.key === orderBy) || COLUMNS[0];
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? genotypes.filter((row) => `g${row.genotype}`.includes(needle) || row.plotIds.some((id) => id.toLowerCase().includes(needle)))
      : genotypes;
    return [...filtered].sort((a, b) => {
      const va = column.get(a);
      const vb = column.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return direction === 'asc' ? va - vb : vb - va;
    });
  }, [genotypes, orderBy, direction, filter]);

  const sortBy = (key) => {
    if (orderBy === key) setDirection(direction === 'asc' ? 'desc' : 'asc');
    else {
      setOrderBy(key);
      setDirection(key === 'rank' || key === 'genotype' || key === 'daysTo50' ? 'asc' : 'desc');
    }
  };

  const selectedSet = new Set(selected);

  return (
    <TableContainer sx={(theme) => ({ ...frame(theme), maxHeight: 520 })}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {COLUMNS.map((column) => (
              <TableCell key={column.key} align={column.align} sortDirection={orderBy === column.key ? direction : false}>
                <Tooltip title={column.help || ''} placement="top" disableHoverListener={!column.help}>
                  <TableSortLabel
                    active={orderBy === column.key}
                    direction={orderBy === column.key ? direction : 'asc'}
                    onClick={() => sortBy(column.key)}
                  >
                    {column.key === 'coverAt' ? `Cover @ ${targetDap} DAP` : column.label}
                  </TableSortLabel>
                </Tooltip>
              </TableCell>
            ))}
            <TableCell>QC</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={COLUMNS.length + 1}>
                <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
                  No genotype matches “{filter}”.
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => {
            const isSelected = selectedSet.has(row.genotype);
            return (
              <TableRow
                key={row.genotype}
                hover
                selected={isSelected}
                onClick={() => onToggle?.(row.genotype)}
                sx={{ cursor: onToggle ? 'pointer' : 'default', '&.Mui-selected td': { bgcolor: 'primary.lighter' } }}
              >
                <TableCell sx={mono} align="right">
                  {row.rank}
                </TableCell>
                <TableCell>
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline' }}>
                    <Typography variant="subtitle2" sx={{ ...mono, color: isSelected ? 'primary.main' : 'text.primary' }}>
                      G{row.genotype}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.plotIds.join(' ')}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell sx={mono} align="right">
                  {row.reps}
                </TableCell>
                <TableCell sx={mono} align="right">
                  {row.traits.daysTo50 == null ? (
                    <Box component="span" sx={{ color: 'text.disabled' }}>
                      —
                    </Box>
                  ) : row.traits.daysTo50Censored ? (
                    <Tooltip title="Already past 50 % on the first flight — the crossing happened before the series starts">
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        {'<'}
                        {fmt(row.traits.daysTo50, 0)}
                      </Box>
                    </Tooltip>
                  ) : (
                    fmt(row.traits.daysTo50, 0)
                  )}
                </TableCell>
                <TableCell sx={mono} align="right">
                  {row.traits.auc.toLocaleString('en-US')}
                </TableCell>
                <TableCell sx={mono} align="right">
                  <Tooltip title={row.traits.maxRateWindow || ''}>
                    <span>{fmt(row.traits.maxRate, 2)}</span>
                  </Tooltip>
                </TableCell>
                <TableCell sx={mono} align="right">
                  {fmt(row.traits.coverAt)}
                </TableCell>
                <TableCell sx={{ ...mono, fontWeight: 600 }} align="right">
                  {fmt(row.traits.finalCover)}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color={row.rejected ? 'error.main' : row.edited ? 'success.main' : 'text.disabled'}>
                    {row.rejected ? `${row.rejected} rejected` : row.edited ? `${row.edited} corrected` : '—'}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

TraitsTable.propTypes = {
  genotypes: PropTypes.array.isRequired,
  targetDap: PropTypes.number,
  selected: PropTypes.array,
  onToggle: PropTypes.func,
  filter: PropTypes.string
};
