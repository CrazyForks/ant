#ifndef VERSION_H
#define VERSION_H

#include <stdbool.h>
#include <stdio.h>

int ant_version(void *argtable[]);
int ant_upgrade(int argc, char **argv);
bool ant_version_print_update_hint(FILE *out);

#endif
